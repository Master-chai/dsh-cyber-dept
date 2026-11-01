import { ACTION_SPEC, CLIENT_REQUEST, COMMAND_METHOD, COMMAND_ACTION, MAX_BLOCKERS, MAX_DESCRIPTION_LENGTH, MAX_ID_LENGTH, MAX_MEMBER_NAME_LENGTH, MAX_MESSAGE_LENGTH, MAX_RPC_ID_LENGTH, MAX_SUBJECT_LENGTH, MAX_TASK_ID_LENGTH, MAX_WRITE_SCOPES, MAX_WRITE_SCOPE_LENGTH, isPlainObject } from '../../shared/contract.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** A team task id is 'task-<n>' (agent-team task-view vocabulary). */
const TASK_ID_PATTERN = /^task-[0-9]+$/u;

/** Whether a value is a plain object. */
function isRecord(value) {
  return isPlainObject(value);
}

/** @param {unknown} value @param {number} max @param {boolean} nonEmpty */
function readText(value, max, nonEmpty) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (nonEmpty && text.length === 0) return null;
  if (text.length > max) return null;
  return text;
}

/** @param {unknown} value */
function readTaskId(value) {
  const text = readText(value, MAX_TASK_ID_LENGTH, true);
  return text !== null && TASK_ID_PATTERN.test(text) ? text : null;
}

/** @param {unknown} value */
function readRevision(value) {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : null;
}

/** @param {unknown} value @returns {string[] | null} */
function readBlockers(value) {
  if (!Array.isArray(value) || value.length > MAX_BLOCKERS) return null;
  const ids = [];
  for (const entry of value) {
    const id = readTaskId(entry);
    if (id === null) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Validate advisory write scopes. The office only checks shape and portability
 * here (relative, no '..'); normalization and overlap warnings belong to the
 * task board, which is the single owner of that vocabulary.
 * @param {unknown} value @returns {string[] | null}
 */
function readWriteScopes(value) {
  if (!Array.isArray(value) || value.length > MAX_WRITE_SCOPES) return null;
  const scopes = [];
  for (const entry of value) {
    const scope = readText(entry, MAX_WRITE_SCOPE_LENGTH, true);
    if (scope === null) return null;
    const normalized = scope.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
    if (normalized.length === 0 || normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)) return null;
    if (normalized.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return null;
    if (!scopes.includes(normalized)) scopes.push(normalized);
  }
  return scopes;
}

/**
 * Validate and normalize one action's arguments. Normalization here is the ONLY
 * place a client value becomes a service argument, so both the whitelist and the
 * per-action shape live together.
 * @param {string} action
 * @param {unknown} raw
 * @returns {{ok: true, args: Record<string, any>} | {ok: false, reason: string}}
 */
export function readCommandArgs(action, raw) {
  if (!isRecord(raw)) return { ok: false, reason: 'args-not-object' };
  if (!Object.hasOwn(ACTION_SPEC, action)) return { ok: false, reason: 'unknown-action' };
  const spec = ACTION_SPEC[action];
  const allowed = new Set([...spec.required, ...spec.optional]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return { ok: false, reason: 'unexpected-argument:' + key };
  }
  for (const key of spec.required) {
    if (!Object.hasOwn(raw, key)) return { ok: false, reason: 'missing-argument:' + key };
  }
  switch (action) {
    case COMMAND_ACTION.taskCreate: {
      const subject = readText(raw.subject, MAX_SUBJECT_LENGTH, true);
      const description = readText(raw.description, MAX_DESCRIPTION_LENGTH, true);
      if (subject === null) return { ok: false, reason: 'invalid-subject' };
      if (description === null) return { ok: false, reason: 'invalid-description' };
      const blockedBy = raw.blockedBy === undefined ? [] : readBlockers(raw.blockedBy);
      if (blockedBy === null) return { ok: false, reason: 'invalid-blocked-by' };
      const writeScopes = raw.writeScopes === undefined ? [] : readWriteScopes(raw.writeScopes);
      if (writeScopes === null) return { ok: false, reason: 'invalid-write-scopes' };
      return { ok: true, args: { subject, description, blockedBy, writeScopes } };
    }
    case COMMAND_ACTION.taskAssign: {
      const taskId = readTaskId(raw.taskId);
      const expectedRevision = readRevision(raw.expectedRevision);
      const owner = readText(raw.owner, MAX_MEMBER_NAME_LENGTH, true);
      if (taskId === null) return { ok: false, reason: 'invalid-task-id' };
      if (expectedRevision === null) return { ok: false, reason: 'invalid-expected-revision' };
      if (owner === null) return { ok: false, reason: 'invalid-owner' };
      return { ok: true, args: { taskId, expectedRevision, owner } };
    }
    case COMMAND_ACTION.taskComplete:
    case COMMAND_ACTION.taskDelete:
    case COMMAND_ACTION.taskStart:
    case COMMAND_ACTION.taskReopen: {
      const taskId = readTaskId(raw.taskId);
      const expectedRevision = readRevision(raw.expectedRevision);
      if (taskId === null) return { ok: false, reason: 'invalid-task-id' };
      if (expectedRevision === null) return { ok: false, reason: 'invalid-expected-revision' };
      return { ok: true, args: { taskId, expectedRevision } };
    }
    case COMMAND_ACTION.messageSend: {
      const target = readText(raw.target, MAX_MEMBER_NAME_LENGTH, true);
      const text = readText(raw.text, MAX_MESSAGE_LENGTH, true);
      if (target === null) return { ok: false, reason: 'invalid-target' };
      if (text === null) return { ok: false, reason: 'invalid-text' };
      return { ok: true, args: { target, text } };
    }
    case COMMAND_ACTION.agentInterrupt: {
      const target = readText(raw.target, MAX_MEMBER_NAME_LENGTH, true);
      if (target === null) return { ok: false, reason: 'invalid-target' };
      return { ok: true, args: { target } };
    }
    default:
      return { ok: false, reason: 'unknown-action' };
  }
}

/**
 * Validate one client-request envelope for the command route.
 *
 * A failure here is an envelope problem (HTTP 400). Anything that survives this
 * function is a well-formed command whose only remaining failures are domain
 * errors reported as 200 + ok:false.
 *
 * @param {unknown} body
 * @returns {{ok: true, rpcId: string, payload: {commandId: string, sessionId: string, action: string, args: Record<string, any>}} | {ok: false, reason: string}}
 */
export function readCommandEnvelope(body) {
  if (!isRecord(body)) return { ok: false, reason: 'envelope-not-object' };
  if (body.type !== CLIENT_REQUEST) return { ok: false, reason: 'envelope-type' };
  if (typeof body.rpcId !== 'string' || body.rpcId.length === 0 || body.rpcId.length > MAX_RPC_ID_LENGTH) {
    return { ok: false, reason: 'envelope-rpc-id' };
  }
  if (body.method !== COMMAND_METHOD) return { ok: false, reason: 'envelope-method' };
  const payload = body.payload;
  if (!isRecord(payload)) return { ok: false, reason: 'payload-not-object' };
  if (typeof payload.commandId !== 'string' || !UUID_PATTERN.test(payload.commandId)) {
    return { ok: false, reason: 'payload-command-id' };
  }
  if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0 || payload.sessionId.length > MAX_ID_LENGTH) {
    return { ok: false, reason: 'payload-session-id' };
  }
  if (typeof payload.action !== 'string') return { ok: false, reason: 'payload-action' };
  const args = readCommandArgs(payload.action, payload.args);
  if (!args.ok) return { ok: false, reason: args.reason };
  return {
    ok: true,
    rpcId: body.rpcId,
    payload: {
      commandId: payload.commandId.toLowerCase(),
      sessionId: payload.sessionId,
      action: payload.action,
      args: args.args,
    },
  };
}
