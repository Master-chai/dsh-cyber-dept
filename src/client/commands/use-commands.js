import React from 'react';
import { taskRefOf, taskRefOfValue, validateWrite } from './protocol.js';
import { commandScope, officeCommandController } from './controller.js';

/** Derive permission/target facts once; rendering and submission use the same decision. */
export function commandCapabilities(props) {
  const seat = props.seat && props.taskOverride ? { ...props.seat, task: props.taskOverride } : props.seat;
  const floor = props.floor;
  const gate = props.writeGate && typeof props.writeGate.enabled === 'boolean' ? props.writeGate : { enabled: false, reason: '写通道不可用。' };
  const canWrite = gate.enabled === true;
  const floorId = floor?.id || '';
  const taskRef = taskRefOf(seat);
  const completedRef = taskRefOfValue(seat?.completedTask);
  const taskReady = !!(taskRef?.id && taskRef.revision > 0);
  const taskCompleted = taskRef?.status === 'completed';
  const actionRef = taskReady ? taskRef : completedRef?.id && completedRef.revision > 0 ? completedRef : null;
  const actionKind = actionRef ? actionRef.status === 'completed' ? 'reopen' : 'complete' : '';
  const blockedReason = gate.reason || '只读模式';
  const selfTarget = !!seat && (seat.role === 'lead' || seat.id === floorId || seat.id === floor?.leadId);
  const memberReady = !!seat && seat.phase !== 'provisioning' && seat.phase !== 'failed';
  const messageAllowed = !!(canWrite && !selfTarget && memberReady && seat.name);
  const interruptAllowed = messageAllowed && ['thinking', 'streaming', 'tool-running', 'waiting-approval'].includes(seat.state);
  const assignAllowed = !!(canWrite && memberReady && seat.name);
  const taskAllowed = !!(canWrite && actionRef && ['in_progress', 'completed'].includes(actionRef.status));
  return { seat, floor, gate, canWrite, floorId, taskRef, taskReady, taskCompleted, actionRef, actionKind, blockedReason, selfTarget, memberReady, messageAllowed, interruptAllowed, assignAllowed, taskAllowed };
}

function statusOfOutcome(view) {
  if (view.phase === 'running') return null;
  if (view.kind === 'assign') return {
    tone: view.phase === 'done' ? 'ok' : 'warn',
    text: view.doneMessage || (view.task ? '任务 ' + view.task.id + ' 已保留，请刷新核对指派结果。' : view.error.title),
  };
  return view.phase === 'done' ? { tone: 'ok', text: view.doneMessage } : { tone: 'error', text: view.error.title + '（' + view.error.code + '）' };
}

/** Dialog presentation subscribes to command ownership rather than owning the request. */
export function useOfficeCommands(props) {
  const facts = commandCapabilities(props);
  const { seat, floorId, actionRef, canWrite, blockedReason } = facts;
  const [write, setWrite] = React.useState(null);
  const [last, setLast] = React.useState(null);
  const controller = props.commandController || officeCommandController;
  const scope = commandScope(floorId, seat?.id, props.taskOverride?.id);
  const current = React.useRef({ scope, facts, props, mounted: true });
  current.current.scope = scope;
  current.current.facts = facts;
  current.current.props = props;
  const handled = React.useRef(null);

  function accept(record) {
    if (!record || !current.current.mounted || current.current.scope !== scope) return;
    setWrite(record.view);
    if (record.settledAt !== null) {
      setLast(statusOfOutcome(record.view));
      if (handled.current !== record) {
        handled.current = record;
        if (record.view.refreshNeeded && typeof current.current.props.onRefresh === 'function') current.current.props.onRefresh();
      }
    }
  }

  React.useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; };
  }, []);
  React.useEffect(() => {
    handled.current = null;
    const record = controller.get(scope);
    setWrite(record?.settledAt === null ? record.view : null);
    setLast(record && record.settledAt !== null ? statusOfOutcome(record.view) : null);
    return controller.subscribe(scope, accept);
  }, [scope, controller]);
  React.useEffect(() => {
    if (!write || write.phase === 'running' || typeof document === 'undefined' || !document.addEventListener) return undefined;
    const escape = event => { if (event.key === 'Escape') closeWrite(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [write ? write.phase + ':' + write.kind : '', scope]);

  function closeWrite() { setWrite(null); controller.dismiss(scope); }
  function open(draft) {
    const pending = controller.get(scope);
    if (pending?.settledAt === null) { setWrite(pending.view); return; }
    setWrite({ phase: 'compose', floorId, seatName: seat?.name || '', fieldError: '', ...draft });
  }
  const openMessage = () => open({ kind: 'message', text: '' });
  const openInterrupt = () => open({ kind: 'interrupt', seatState: seat?.state });
  const openAssign = () => open({ kind: 'assign', subject: '', description: '' });
  function openTask(kind) {
    if (!actionRef?.id || !actionRef.revision) return;
    open({ kind, taskId: actionRef.id, taskRevision: actionRef.revision, taskSubject: actionRef.subject });
  }
  const openComplete = () => openTask('complete');
  const openReopen = () => openTask('reopen');
  const patchWrite = patch => setWrite(previous => previous ? { ...previous, ...patch } : previous);

  async function runWrite(draft) {
    if (!draft || draft.phase !== 'compose') return;
    if (current.current.scope !== scope) return;
    const latest = current.current.facts;
    if (!latest.canWrite) { setWrite({ ...draft, fieldError: '写通道不可用：' + latest.blockedReason }); return; }
    if (draft.floorId !== latest.floorId || draft.seatName !== latest.seat?.name ||
      (draft.kind === 'message' && !latest.messageAllowed) ||
      (draft.kind === 'interrupt' && !latest.interruptAllowed) ||
      (draft.kind === 'assign' && !latest.assignAllowed) ||
      (['complete', 'reopen'].includes(draft.kind) && !latest.taskAllowed)) {
      setWrite({ ...draft, fieldError: '目标或状态已变化，请关闭后重新选择。' }); return;
    }
    const problem = validateWrite(draft);
    if (problem) { setWrite({ ...draft, fieldError: problem }); return; }
    const promise = controller.run(scope, draft);
    accept(controller.get(scope));
    const result = await promise;
    // This also supports a synchronous test renderer without effects. Real subscriptions
    // may already have received this record; handled prevents duplicate refreshes.
    const record = controller.get(scope);
    if (record) accept(record);
    else if (current.current.mounted && current.current.scope === scope) { setWrite({ ...draft, ...result }); setLast(statusOfOutcome({ ...draft, ...result })); }
  }
  function refreshAndClose() { if (typeof props.onRefresh === 'function') props.onRefresh(); closeWrite(); }
  function onBackdrop(event) { if (event?.target === event?.currentTarget && write?.phase !== 'running') closeWrite(); }

  return { ...facts, write, last, canWrite, blockedReason, openMessage, openInterrupt, openComplete, openReopen, openAssign, patchWrite, closeWrite, refreshAndClose, onBackdrop, runWrite };
}
