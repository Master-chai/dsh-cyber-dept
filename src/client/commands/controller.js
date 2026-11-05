import { officeReceipts } from './receipts.js';
import { isObject } from '../common.js';
import { WRITE_ACTION, actionOfWrite, argsOfWrite, describeWriteError, describeWriteSuccess, postOfficeCommand } from './protocol.js';

/** @typedef {'compose'|'running'|'done'|'error'|'unowned'|'assigned'} OperationPhase */
/** @typedef {{kind:string, phase:OperationPhase, floorId:string, seatName:string, taskId?:string, taskRevision?:number, taskSubject?:string, subject?:string, description?:string, text?:string}} CommandDraft */
/** @typedef {{phase:OperationPhase, task?:object|null, value?:object, error?:object, doneMessage?:string, refreshNeeded:boolean}} CommandOutcome */

/** Execute a captured intent independently of the component that created it. No retries. */
export async function executeCommandIntent(current, post = postOfficeCommand) {
  try {
    if (current.kind === 'assign') return await executeAssignment(current, post);
    const result = await post(current.floorId, actionOfWrite(current), argsOfWrite(current));
    if (!result || result.ok !== true) return { phase: 'error', error: describeWriteError(result?.error), refreshNeeded: true };
    const value = isObject(result.value) ? result.value : {};
    return { phase: 'done', value, task: value.task || null, doneMessage: describeWriteSuccess(current.kind, value, current.seatName), refreshNeeded: true };
  } catch (error) {
    return { phase: 'error', error: describeWriteError(error), refreshNeeded: true };
  }
}

async function executeAssignment(current, post) {
  let task = current.taskId ? { id: current.taskId, revision: current.taskRevision, subject: current.taskSubject, status: 'pending' } : null;
  if (!task) {
    const created = await post(current.floorId, WRITE_ACTION.taskCreate, { subject: current.subject.trim(), description: current.description.trim() });
    if (!created?.ok) return { phase: 'error', error: describeWriteError(created?.error), refreshNeeded: true };
    task = created.value?.task;
  }
  try {
    if (!task?.id || !task.revision) throw { code: 'office/create-unassigned', message: '任务已创建，缺少任务版本，请刷新核对。', details: {} };
    const assigned = await post(current.floorId, WRITE_ACTION.taskAssign, { taskId: task.id, expectedRevision: task.revision, owner: current.seatName });
    if (!assigned?.ok) return { phase: 'unowned', task, error: describeWriteError(assigned?.error), refreshNeeded: true };
    task = assigned.value?.task || task;
  } catch (error) {
    return { phase: 'unowned', task, error: describeWriteError(error), refreshNeeded: true };
  }
  if (!current.executeNow) return { phase: 'done', task, doneMessage: '任务已指派给 ' + current.seatName + '（' + task.id + '）。可在任务看板点击“立即执行”。', refreshNeeded: true };
  // Assignment has committed. Notification failure must never be reported as unassigned.
  try {
    const started = await post(current.floorId, WRITE_ACTION.taskStart, { taskId: task.id, expectedRevision: task.revision });
    if (!started?.ok) throw started?.error || { code: 'office/bad-response' };
    return { phase: 'done', task, value: started.value, doneMessage: '任务已指派给 ' + current.seatName + '，并已发送立即执行指令（' + task.id + '）。实际进度以成员状态和回复为准。', refreshNeeded: true };
  } catch (error) {
    const view = describeWriteError(error);
    return { phase: 'assigned', task, error: view, doneMessage: '任务已指派给 ' + current.seatName + '（' + task.id + '），' + (view.deliveryUnknown ? '执行指令送达结果未知。请先查看成员会话，不要重复派活或重发。' : '执行指令发送失败。请检查成员状态后，在任务看板单独发起“立即执行”。'), refreshNeeded: true };
  }
}

/** Session, member and explicitly selected task form one operation scope. */
export function commandScope(sessionId, memberId, taskId = '') {
  return JSON.stringify([sessionId || '', memberId || '', taskId || '']);
}

/**
 * In-memory command ownership, independent of dialogs. Pending work is never evicted.
 * Settled records are bounded and expire; none are persisted or automatically retried.
 */
export function createCommandController({ execute = executeCommandIntent, capacity = 64, ttlMs = 120000, maxPending = 256, now = Date.now, receipts = officeReceipts } = {}) {
  const records = new Map();
  const listeners = new Map();
  const notify = scope => { for (const listener of listeners.get(scope) || []) listener(records.get(scope)); };
  function prune() {
    for (const [scope, record] of records) {
      if (record.settledAt !== null && now() - record.settledAt >= ttlMs) records.delete(scope);
    }
    let settled = [...records].filter(([, record]) => record.settledAt !== null);
    while (settled.length > capacity) records.delete(settled.shift()[0]);
  }
  return {
    get(scope) { prune(); return records.get(scope) || null; },
    subscribe(scope, listener) {
      if (!listeners.has(scope)) listeners.set(scope, new Set());
      listeners.get(scope).add(listener);
      return () => { const set = listeners.get(scope); if (set) { set.delete(listener); if (!set.size) listeners.delete(scope); } };
    },
    run(scope, draft) {
      prune();
      const existing = records.get(scope);
      if (existing && existing.settledAt === null) return existing.promise;
      const atCapacity = [...records.values()].filter(record => record.settledAt === null).length >= maxPending;
      const intent = { ...draft, phase: 'running', fieldError: '' };
      const record = { intent, view: intent, settledAt: null, promise: null };
      records.delete(scope); records.set(scope, record);
      // Unique object identity prevents one scope's later operation replacing earlier receipts.
      const receiptId = {};
      const receiptAccepted = receipts.record(receiptId, intent) !== false;
      record.promise = Promise.resolve().then(() => !receiptAccepted
        ? { phase: 'error', error: {code:'office/receipt-capacity',title:'本页未核对操作过多',hint:'新的请求未发送。请先在原生会话核对待处理操作，再明确移出本地提醒；刷新页面只清空本地记录，不会取消或证明旧操作成功。',deliveryUnknown:false}, refreshNeeded:false }
        : atCapacity
        ? { phase: 'error', error: describeWriteError({ code: 'office/busy', message: 'Too many unresolved operations' }), refreshNeeded: false }
        : execute(intent)).catch(error => ({ phase: 'error', error: describeWriteError(error), refreshNeeded: true })).then(outcome => {
        record.view = { ...intent, ...outcome };
        record.settledAt = now();
        if (receiptAccepted) receipts.record(receiptId, intent, outcome);
        notify(scope); prune();
        return record.view;
      });
      notify(scope);
      return record.promise;
    },
    dismiss(scope) {
      const record = records.get(scope);
      if (record && record.settledAt !== null) records.delete(scope);
    },
  };
}

export const officeCommandController = createCommandController();
