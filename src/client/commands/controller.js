import { isObject } from '../common.js';
import { WRITE_ACTION, actionOfWrite, argsOfWrite, describeWriteError, describeWriteSuccess, postOfficeCommand } from './protocol.js';

/** @typedef {'compose'|'running'|'done'|'error'|'unowned'} OperationPhase */
/** @typedef {{kind:string, phase:OperationPhase, floorId:string, seatName:string, taskId?:string, taskRevision?:number, taskSubject?:string, subject?:string, description?:string, text?:string}} CommandDraft */
/** @typedef {{phase:OperationPhase, task?:object|null, value?:object, error?:object, doneMessage?:string, refreshNeeded:boolean}} CommandOutcome */

/** Execute a captured intent independently of the component that created it. No retries. */
export async function executeCommandIntent(current, post = postOfficeCommand) {
  try {
    if (current.kind === 'assign') return await executeAssignment(current, post);
    const result = await post(current.floorId, actionOfWrite(current), argsOfWrite(current));
    if (!result || result.ok !== true) return { phase: 'error', error: describeWriteError(result?.error), refreshNeeded: false };
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
    return { phase: 'done', task: assigned.value?.task || task, doneMessage: '任务已指派给 ' + current.seatName + '（' + task.id + '）。如需立即处理，可发消息通知成员。', refreshNeeded: true };
  } catch (error) {
    return { phase: 'unowned', task, error: describeWriteError(error), refreshNeeded: true };
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
export function createCommandController({ execute = executeCommandIntent, capacity = 64, ttlMs = 120000, maxPending = 256, now = Date.now } = {}) {
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
      record.promise = Promise.resolve().then(() => atCapacity
        ? { phase: 'error', error: describeWriteError({ code: 'office/busy', message: 'Too many unresolved operations' }), refreshNeeded: false }
        : execute(intent)).catch(error => ({ phase: 'error', error: describeWriteError(error), refreshNeeded: true })).then(outcome => {
        record.view = { ...intent, ...outcome };
        record.settledAt = now();
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
