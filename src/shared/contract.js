/**
 * Dependency-free contract shared by the host half and the browser half of
 * the Cyber IT Department plugin.
 *
 * This module is deliberately runtime-free: no 'node:' imports, no React and no
 * cordis. 'client.js' may import it, and the host imports the same constants, so
 * route paths, RPC method names, command actions and error codes can never drift
 * between the two halves. JSDoc typedefs double as the only type documentation
 * for the wire payloads; a TypeScript build is not part of this bundle.
 *
 * @module dsh-cyber-dept/contract
 */

/** Stable plugin id (also the Cordis plugin name). */
export const PLUGIN_ID = 'dsh-cyber-dept';

/** Session-projection key registered by the host half. */
export const PROJECTION_KEY = 'cyberAgent';

/**
 * Session-projection key of the native Agent Teams roster/task view. The office
 * only READS it (every write goes through ctx.agentTeams); naming it here keeps
 * the fold key and the native key from being confused in the cold read path.
 */
export const AGENT_TEAM_KEY = 'agentTeam';

/** Session-projection state version; bump whenever the fold or its state shape changes. */
export const PROJECTION_STATE_VERSION = 1;

/** Read route registered through ctx.connection.fetch.register. */
export const SNAPSHOT_ROUTE = '/api/cyberOffice/snapshot';
/** Write route registered through ctx.connection.fetch.register. */
export const COMMAND_ROUTE = '/api/cyberOffice/command';
/** Envelope method the snapshot route accepts (equals the path after '/api/'). */
export const SNAPSHOT_METHOD = 'cyberOffice/snapshot';
/** Envelope method the command route accepts (equals the path after '/api/'). */
export const COMMAND_METHOD = 'cyberOffice/command';

/** Maximum number of replayable command results kept per host process. */
export const COMMAND_LEDGER_CAPACITY = 256;
/** Replay window for one command result; older entries are dropped. */
export const COMMAND_REPLAY_TTL_MS = 10 * 60 * 1000;
/** Default upper bound for one command round trip that reaches a Team service. */
export const COMMAND_TIMEOUT_MS = 15 * 1000;

/** Longest accepted envelope rpcId. */
export const MAX_RPC_ID_LENGTH = 256;
/** Longest accepted session/agent id. */
export const MAX_ID_LENGTH = 256;
/** Longest accepted teammate name (mirrors the Agent Teams roster limit). */
export const MAX_MEMBER_NAME_LENGTH = 64;
/** Longest accepted task subject (mirrors the Agent Teams task board limit). */
export const MAX_SUBJECT_LENGTH = 200;
/** Longest accepted task description (mirrors the Agent Teams task board limit). */
export const MAX_DESCRIPTION_LENGTH = 16384;
/** Longest accepted message body in characters. */
export const MAX_MESSAGE_LENGTH = 16384;
/** Longest accepted task id. */
export const MAX_TASK_ID_LENGTH = 64;
/** Most blocker ids accepted in one create. */
export const MAX_BLOCKERS = 64;
/** Most advisory write scopes accepted in one create. */
export const MAX_WRITE_SCOPES = 32;
/** Longest accepted advisory write scope. */
export const MAX_WRITE_SCOPE_LENGTH = 512;
/** Longest tool name kept in the projection state. */
export const MAX_TOOL_NAME_LENGTH = 80;
/** Longest approval reason kept in the projection state. */
export const MAX_APPROVAL_REASON_LENGTH = 500;
/** Longest error text kept in the projection state. */
export const MAX_ERROR_LENGTH = 500;
/** Most distinct degradation reasons one snapshot reports. */
export const MAX_DEGRADED_REASONS = 16;

/**
 * Closed phase vocabulary of the cyberAgent projection. It describes the
 * session log - what the agent last committed - never a guess about runtime
 * intent: idle and done are distinct because the client animates them
 * differently, and blocked is the pre-step rejection, not a stalled turn.
 */
export const CYBER_PHASE = Object.freeze({
  idle: 'idle',
  running: 'running',
  tool: 'tool',
  waitingApproval: 'waiting-approval',
  done: 'done',
  blocked: 'blocked',
  error: 'error',
});

/**
 * Closed member-status vocabulary. 'inactive' means "no live Agent for this
 * session id" and is never used as a synonym for 'idle': a dormant teammate
 * and a running teammate that finished its turn are different office states.
 */
export const MEMBER_STATUS = Object.freeze({
  running: 'running',
  idle: 'idle',
  inactive: 'inactive',
});

/**
 * Snapshot health vocabulary. 'live' means every source answered, 'degraded'
 * means at least one optional source was missing or failed but floors were still
 * produced, and 'unavailable' means the host could not even enumerate sessions.
 */
export const OFFICE_STATE = Object.freeze({
  live: 'live',
  degraded: 'degraded',
  unavailable: 'unavailable',
});

/** Envelope type discriminator required by the native Connection carrier. */
export const CLIENT_REQUEST = 'client-request';
/** Envelope type discriminator produced by every route in this plugin. */
export const SERVER_RESPONSE = 'server-response';

/**
 * v1 write actions. Each one maps 1:1 onto an Agent Teams service call made with
 * the Lead identity of the addressed session; the office never invents events.
 */
export const COMMAND_ACTION = Object.freeze({
  taskCreate: 'task.create',
  taskAssign: 'task.assign',
  taskComplete: 'task.complete',
  taskReopen: 'task.reopen',
  messageSend: 'message.send',
  agentInterrupt: 'agent.interrupt',
});

/**
 * Closed argument whitelist per action. Required keys must be present;
 * everything else in args is rejected - the command channel never forwards an
 * argument it has not classified.
 */
export const ACTION_SPEC = Object.freeze({
  'task.create': Object.freeze({ required: Object.freeze(['subject', 'description']), optional: Object.freeze(['blockedBy', 'writeScopes']) }),
  'task.assign': Object.freeze({ required: Object.freeze(['taskId', 'expectedRevision', 'owner']), optional: Object.freeze([]) }),
  'task.complete': Object.freeze({ required: Object.freeze(['taskId', 'expectedRevision']), optional: Object.freeze([]) }),
  'task.reopen': Object.freeze({ required: Object.freeze(['taskId', 'expectedRevision']), optional: Object.freeze([]) }),
  'message.send': Object.freeze({ required: Object.freeze(['target', 'text']), optional: Object.freeze([]) }),
  'agent.interrupt': Object.freeze({ required: Object.freeze(['target']), optional: Object.freeze([]) }),
});

/** Every action id in declaration order (useful for clients that build menus). */
export const COMMAND_ACTIONS = Object.freeze(Object.keys(ACTION_SPEC));

/**
 * Stable office error codes. A domain failure is always HTTP 200 with
 * result.ok === false; only a malformed envelope earns a 400, so the client can
 * unwrap one shape for every server answer.
 */
export const OFFICE_ERROR = Object.freeze({
  teamUnavailable: 'office/team-unavailable',
  sessionNotLive: 'office/session-not-live',
  busy: 'office/busy',
  invalidArgument: 'office/invalid-argument',
  leadRequired: 'office/lead-required',
  notMember: 'office/not-member',
  memberNotFound: 'office/member-not-found',
  staleRevision: 'office/stale-revision',
  taskNotFound: 'office/task-not-found',
  taskDeleted: 'office/task-deleted',
  taskBlocked: 'office/task-blocked',
  taskLimit: 'office/task-limit',
  invalidTransition: 'office/invalid-transition',
  unauthorized: 'office/unauthorized',
  invalidWriteScope: 'office/invalid-write-scope',
  messageTooLarge: 'office/message-too-large',
  selfMessage: 'office/self-message',
  invalidTarget: 'office/invalid-target',
  timeout: 'office/timeout',
  internal: 'office/internal',
  snapshotUnavailable: 'office/snapshot-unavailable',
});

/**
 * Agent Teams TeamError.code to office code. A code absent from this table is
 * reported as OFFICE_ERROR.internal with the original value preserved in
 * error.details.teamCode, so an unexpected failure stays closed but debuggable.
 */
export const TEAM_ERROR_TO_OFFICE = Object.freeze({
  TEAM_NOT_MEMBER: 'office/not-member',
  TEAM_LEAD_REQUIRED: 'office/lead-required',
  TEAM_MEMBER_NOT_FOUND: 'office/member-not-found',
  TEAM_INVALID_TARGET: 'office/invalid-target',
  TEAM_TASK_STALE_REVISION: 'office/stale-revision',
  TEAM_TASK_NOT_FOUND: 'office/task-not-found',
  TEAM_TASK_DELETED: 'office/task-deleted',
  TEAM_TASK_BLOCKED: 'office/task-blocked',
  TEAM_TASK_ALREADY_CLAIMED: 'office/invalid-transition',
  TEAM_TASK_INVALID_TRANSITION: 'office/invalid-transition',
  TEAM_TASK_UNAUTHORIZED: 'office/unauthorized',
  TEAM_TASK_LIMIT: 'office/task-limit',
  TEAM_TASK_HAS_DEPENDENTS: 'office/invalid-transition',
  TEAM_TASK_DEPENDENCY_CYCLE: 'office/invalid-argument',
  TEAM_INVALID_ARGUMENT: 'office/invalid-argument',
  TEAM_INVALID_WRITE_SCOPE: 'office/invalid-write-scope',
  TEAM_INVALID_MEMBER_NAME: 'office/invalid-argument',
  TEAM_MEMBER_LIMIT: 'office/task-limit',
  TEAM_MEMBER_NAME_TAKEN: 'office/invalid-argument',
  TEAM_PROVISIONING_CONFLICT: 'office/invalid-transition',
  TEAM_MESSAGE_TOO_LARGE: 'office/message-too-large',
  TEAM_SELF_MESSAGE: 'office/self-message',
  TEAM_DISPOSED: 'office/team-unavailable',
  TEAM_WAIT_ABORTED: 'office/timeout',
  TEAM_INVALID_TIMEOUT: 'office/invalid-argument',
});

/** RPC id the plugin echoes when it cannot read the caller's id at all. */
export const FALLBACK_RPC_ID = 'cyber-office-invalid-rpc-id';

/**
 * @typedef {'idle' | 'running' | 'tool' | 'waiting-approval' | 'done' | 'blocked' | 'error'} CyberPhase
 * @typedef {{name: string | null, callId: string | null}} CyberTool
 * @typedef {{id: string, toolName: string, reason: string | null}} CyberApproval
 * @typedef {{phase: CyberPhase, since: number | null, turn: number | null, tool: CyberTool | null, approval: CyberApproval | null, error: string | null}} CyberAgentView
 * @typedef {CyberAgentView & {seq: number}} CyberAgentState
 *
 * @typedef {'running' | 'idle' | 'inactive'} MemberStatus
 * @typedef {'lead' | 'teammate'} MemberRole
 * @typedef {'provisioning' | 'active' | 'failed'} MemberPhase
 * @typedef {{id: string, name: string, role: MemberRole, phase: MemberPhase, status: MemberStatus, agentAvailable: boolean, description: string, error: string | null}} OfficeMember
 * @typedef {{pending: number, inProgress: number, completed: number, blocked: number, total: number}} OfficeTaskCounts
 * @typedef {{id: string, kind: 'team', title: string | null, cwd: string | null, live: boolean, agentAvailable: boolean, running: boolean, teamSource: 'live' | 'cached', memberCount: number, members: OfficeMember[], taskCounts: OfficeTaskCounts, failure: string | null, createdAt: number | null}} OfficeFloor
 * @typedef {{sessionId: string | null, isDepartment: boolean, floorId: string | null}} OfficeCurrent
 * @typedef {{teams: boolean, projectionCache: boolean, sessionQuery: boolean, agents: boolean, reasons: string[]}} OfficeDegraded
 * @typedef {{v: 1, state: 'live' | 'degraded' | 'unavailable', sampledAt: number, asOf: number, floors: OfficeFloor[], current: OfficeCurrent, degraded: OfficeDegraded}} OfficeSnapshot
 *
 * @typedef {{code: string, message: string, details: Record<string, unknown>}} OfficeError
 * @typedef {{ok: true, value: Record<string, unknown>} | {ok: false, error: OfficeError}} OfficeResult
 */

/** Whether value is a non-array object record. */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Build a success result. */
export function ok(value) {
  return { ok: true, value };
}

/** Build a domain error result (HTTP 200, result.ok === false). */
export function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}
