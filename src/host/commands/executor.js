import { COMMAND_ACTION, COMMAND_TIMEOUT_MS, OFFICE_ERROR, TEAM_ERROR_TO_OFFICE, fail, ok } from '../../shared/contract.js';
import { createExecutionMessage, executionText } from './execution-message.js';

function getService(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Trim one Team TaskView down to the fields the office renders. The full view
 * (description, write scopes, warnings) stays in the session projection where
 * it is already client-visible; echoing it back would double the payload for no
 * reader.
 * @param {any} task
 */
function taskSummary(task) {
  if (task === null || typeof task !== 'object') return null;
  return {
    id: typeof task.id === 'string' ? task.id : '',
    revision: Number.isSafeInteger(task.revision) ? task.revision : 0,
    subject: typeof task.subject === 'string' ? task.subject : '',
    status: typeof task.status === 'string' ? task.status : 'pending',
    ownerName: typeof task.ownerName === 'string' ? task.ownerName : null,
    ready: task.ready === true,
  };
}

/**
 * The cancellation signal handed to services that require one. Team sendMessage
 * demands a signal (it feeds AbortSignal.any internally), so the office always
 * supplies a bounded one and never makes the round trip unbounded.
 * @param {{signal?: AbortSignal, timeoutMs?: number}} options
 * @returns {AbortSignal}
 */
function signalOf(options) {
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : COMMAND_TIMEOUT_MS;
  const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
  const caller = options.signal;
  const usable = caller !== undefined && caller !== null && typeof caller === 'object' && typeof caller.aborted === 'boolean';
  if (usable && timeout !== undefined) {
    try {
      return AbortSignal.any([caller, timeout]);
    } catch {
      return caller;
    }
  }
  if (usable) return caller;
  return timeout ?? new AbortController().signal;
}

/**
 * Map one thrown service failure onto a stable office result. Unknown codes stay
 * closed as office/internal but keep the original code in details.teamCode, so a
 * new Team failure is visible without widening the vocabulary's meaning.
 * @param {unknown} error
 * @param {string} action
 * @returns {import('../../shared/contract.js').OfficeResult}
 */
export function failFromError(error, action) {
  const record = error !== null && typeof error === 'object' ? error : undefined;
  const rawCode = typeof record?.code === 'string' ? record.code : null;
  const message = typeof record?.message === 'string' ? record.message : String(error);
  const name = typeof record?.name === 'string' ? record.name : '';
  if (rawCode === 'ABORT_ERR' || rawCode === 'TEAM_WAIT_ABORTED' || name === 'AbortError' || name === 'TimeoutError') {
    if (action === COMMAND_ACTION.messageSend || action === COMMAND_ACTION.taskStart) {
      return fail(
        OFFICE_ERROR.timeout,
        'The Team service did not acknowledge the message in time. Team messages are not de-duplicated, so it may already have been delivered; check the target before resending.',
        { deliveryUnknown: true },
      );
    }
    return fail(OFFICE_ERROR.timeout, 'The Team service did not answer in time; check the task before repeating the operation.', { deliveryUnknown: true });
  }
  if (rawCode !== null) {
    const mapped = TEAM_ERROR_TO_OFFICE[rawCode];
    if (mapped !== undefined) return fail(mapped, message, { teamCode: rawCode });
    return fail(OFFICE_ERROR.internal, message, { teamCode: rawCode });
  }
  return fail(OFFICE_ERROR.internal, message, {});
}

/**
 * Execute one validated command against the Agent Teams service.
 *
 * The Lead identity is the exact live Agent object for the addressed session:
 * the service validates object identity and role, never the caller's origin, so
 * this is the plugin's trust boundary and the reason every write still passes
 * through a human confirmation in the browser.
 *
 * @param {any} ctx
 * @param {{commandId: string, sessionId: string, action: string, args: Record<string, any>}} payload
 * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
 * @returns {Promise<import('../../shared/contract.js').OfficeResult>}
 */
async function executeServiceCommand(ctx, payload, options = {}) {
  const teams = getService(ctx, 'agentTeams');
  if (teams === undefined || teams === null) {
    return fail(OFFICE_ERROR.teamUnavailable, 'Agent Teams is not available in this profile, so office actions are disabled.', {});
  }
  const agents = getService(ctx, 'agents');
  const lead = typeof agents?.get === 'function' ? agents.get(payload.sessionId) : undefined;
  if (lead === undefined || lead === null) {
    return fail(OFFICE_ERROR.sessionNotLive, 'The session is not live right now. Open it in DSH before sending office actions.', { sessionId: payload.sessionId });
  }
  const args = payload.args;
  try {
    /** @type {Record<string, unknown>} */
    let value;
    switch (payload.action) {
      case COMMAND_ACTION.taskCreate: {
        const task = await teams.createTask(lead, {
          subject: args.subject,
          description: args.description,
          blockedBy: args.blockedBy,
          writeScopes: args.writeScopes,
        });
        value = { task: taskSummary(task) };
        break;
      }
      case COMMAND_ACTION.taskAssign: {
        const task = await teams.updateTask(lead, {
          taskId: args.taskId,
          expectedRevision: args.expectedRevision,
          action: 'reassign',
          owner: args.owner,
        });
        value = { task: taskSummary(task) };
        break;
      }
      case COMMAND_ACTION.taskComplete: {
        const task = await teams.updateTask(lead, {
          taskId: args.taskId,
          expectedRevision: args.expectedRevision,
          action: 'complete',
        });
        value = { task: taskSummary(task) };
        break;
      }
      case COMMAND_ACTION.taskReopen: {
        const task = await teams.updateTask(lead, {
          taskId: args.taskId,
          expectedRevision: args.expectedRevision,
          action: 'reopen',
        });
        value = { task: taskSummary(task) };
        break;
      }
      case COMMAND_ACTION.taskDelete: {
        const task = await teams.updateTask(lead, {
          taskId: args.taskId,
          expectedRevision: args.expectedRevision,
          action: 'delete',
        });
        value = { task: taskSummary(task) };
        break;
      }
      case COMMAND_ACTION.taskStart: {
        // Resolve the owner on the host. A stale browser cannot notify a former owner.
        const task = await teams.getTask(lead, args.taskId);
        if (!task) return fail(OFFICE_ERROR.taskNotFound, 'The task no longer exists.');
        if (task.status === 'deleted') return fail(OFFICE_ERROR.taskDeleted, 'The task has been deleted.');
        if (task.revision !== args.expectedRevision) return fail(OFFICE_ERROR.staleRevision, 'The task changed; refresh before requesting execution.');
        if (task.status !== 'in_progress' || !task.ownerName) return fail(OFFICE_ERROR.invalidTransition, 'Assign an active task to a member before requesting execution.');
        for (const id of task.blockedBy || []) {
          const blocker = await teams.getTask(lead, id);
          if (!blocker || blocker.status !== 'completed') return fail(OFFICE_ERROR.taskBlocked, 'A task dependency is not complete.');
        }
        const latest = await teams.getTask(lead, args.taskId);
        if (!latest || latest.revision !== task.revision || latest.ownerName !== task.ownerName || latest.status !== 'in_progress') {
          return fail(OFFICE_ERROR.staleRevision, 'The task changed while checking its dependencies.');
        }
        const signal = signalOf(options);
        signal.throwIfAborted();
        if (agents.get(payload.sessionId) !== lead) return fail(OFFICE_ERROR.sessionNotLive, 'The live session changed before dispatch; refresh before requesting execution.');
        let messageId;
        if (task.ownerName === 'lead') {
          // Team sendMessage rejects self-delivery. Use the same public waking
          // inbox boundary as native lead delivery, with honest plugin provenance.
          if (typeof teams.membership !== 'function' || typeof lead.steer !== 'function') {
            return fail(OFFICE_ERROR.executionUnavailable, 'This host does not expose the supported Lead execution API. No execution instruction was sent.');
          }
          const membership = teams.membership(lead);
          if (membership?.root !== lead || membership?.role !== 'lead') return fail(OFFICE_ERROR.leadRequired, 'Lead execution must address the exact live Team root.');
          const message = createExecutionMessage(task, payload.commandId);
          try {
            lead.steer(message);
          } catch (error) {
            // A driver/persistence exception can occur after inbox acceptance.
            // Do not encourage an unsafe resend when that boundary is uncertain.
            const failed = failFromError(error, payload.action);
            return fail(failed.error.code, failed.error.message, { ...failed.error.details, deliveryUnknown: true, messageId: message.id });
          }
          messageId = message.id;
        } else {
          if (typeof teams.sendMessage !== 'function') {
            return fail(OFFICE_ERROR.executionUnavailable, 'This host does not expose the supported Team execution API. No execution instruction was sent.');
          }
          let accepted;
          try {
            accepted = await teams.sendMessage(lead, {
              target: task.ownerName,
              content: [{ type: 'text', text: executionText(task) }],
              signal,
            });
          } catch (error) {
            // Native delivery can accept the message before persistence or
            // activity notification throws. Preserve the error, but never
            // assume a rejection from this boundary proves non-delivery.
            const failed = failFromError(error, payload.action);
            return fail(failed.error.code, failed.error.message, { ...failed.error.details, deliveryUnknown: true });
          }
          messageId = accepted?.messageId;
          if (typeof messageId !== 'string' || messageId.length === 0) {
            return fail(OFFICE_ERROR.internal, 'The host did not return a message receipt. Check the target session before resending.', { deliveryUnknown: true });
          }
        }
        // Inbox acceptance is not evidence that a model request has started.
        value = { task: taskSummary(task), target: task.ownerName, messageId, execution: 'accepted' };
        break;
      }
      case COMMAND_ACTION.messageSend: {
        const accepted = await teams.sendMessage(lead, {
          target: args.target,
          content: [{ type: 'text', text: args.text }],
          signal: signalOf(options),
        });
        value = { messageId: typeof accepted?.messageId === 'string' ? accepted.messageId : null };
        break;
      }
      case COMMAND_ACTION.agentInterrupt: {
        const result = teams.interrupt(lead, args.target);
        value = {
          target: args.target,
          previousStatus: result?.previousStatus === 'running' ? 'running' : 'inactive',
        };
        break;
      }
      default:
        throw Object.assign(new Error('unsupported office action ' + String(payload.action)), { code: 'TEAM_INVALID_ARGUMENT' });
    }
    return ok({
      action: payload.action,
      commandId: payload.commandId,
      sessionId: payload.sessionId,
      ...value,
    });
  } catch (error) {
    return failFromError(error, payload.action);
  }
}

// Stop waiting without pretending that an uncancellable Team write has stopped.
// onSettled belongs to the route ledger and runs only when the actual write ends.
export function executeOfficeCommand(ctx, payload, options = {}) {
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : COMMAND_TIMEOUT_MS;
  const operation = Promise.resolve().then(() => {
    options.signal?.throwIfAborted();
    return executeServiceCommand(ctx, payload, options);
  }).catch(error => failFromError(error, payload.action));
  return new Promise(resolve => {
    let finished = false;
    const unknown = () => fail(OFFICE_ERROR.timeout, 'The operation may still be running. Check its result before sending another command.', { deliveryUnknown: true, commandId: payload.commandId, pending: true });
    const finish = result => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      options.signal?.removeEventListener('abort', aborted);
      resolve(result);
    };
    const aborted = () => finish(unknown());
    const timer = setTimeout(() => finish(unknown()), timeoutMs);
    options.signal?.addEventListener('abort', aborted, { once: true });
    if (options.signal?.aborted) aborted();
    operation.then(result => {
      if (options.onSettled) options.onSettled(result);
      finish(result);
    });
  });
}
