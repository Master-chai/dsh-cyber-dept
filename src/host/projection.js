/**
 * The cyberAgent session projection: one pure fold per session that answers
 * "what has this agent's log last committed?" without replaying the log in the
 * browser.
 *
 * The fold is deliberately narrow - phase, since, turn, tool, approval, error,
 * seq - because it is driven eagerly on every committed event of every session.
 * Everything that needs a richer view (roster, tasks, token usage) has its own
 * projection or host route; the office only needs the state machine signals that
 * the runtime agent/status boolean cannot express.
 *
 * Two contract rules are load-bearing here:
 *
 * 1. An unrelated event returns the SAME state reference. The registry gates its
 *    change feed on Object.is, so a fresh-but-equal object would republish a
 *    wire frame for every message in every session.
 * 2. The wire view exposes UI fields only: seq is the fold's watermark, not
 *    something a client may reason about, and tool/approval objects are copied
 *    so a client cannot reach into host state.
 *
 * @module dsh-cyber-dept/host/projection
 */
import {
  CYBER_PHASE,
  MAX_APPROVAL_REASON_LENGTH,
  MAX_ERROR_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  PROJECTION_KEY,
  PROJECTION_STATE_VERSION,
} from '../shared/contract.js';

/**
 * Passthrough schema with the two methods the projection registry calls:
 * stateSchema.parse on persisted-cache rows and wire.viewSchema.parse on every
 * served value. The fold's state is plain JSON by construction, so an identity
 * parse is the honest contract - it never hides a shape violation, and it never
 * clones (the registry's own double-buffer compares references).
 */
export const passthroughSchema = Object.freeze({
  parse: (value) => value,
  safeParse: (value) => ({ success: true, data: value }),
});

/** @param {unknown} value */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** @param {unknown} value */
function isTurnNumber(value) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/**
 * A defensive, bounded string slice: event payloads are persisted JSON, so a
 * missing or mistyped field must degrade rather than throw.
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string | null}
 */
function textOrNull(value, maxLength) {
  if (typeof value !== 'string') return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** @param {any} event @param {number | null} fallback */
function timeOf(event, fallback) {
  return isFiniteNumber(event.time) ? event.time : fallback;
}

/** @param {any} event @param {number} fallback */
function seqOf(event, fallback) {
  return Number.isSafeInteger(event.seq) ? event.seq : fallback;
}

/**
 * Build one next state. Every caller has already decided that the event is
 * relevant, so this is the single place that stamps the watermark.
 * @param {any} state
 * @param {Record<string, unknown>} patch
 * @param {any} event
 * @returns {import('../shared/contract.js').CyberAgentState}
 */
function nextState(state, patch, event) {
  return { ...state, ...patch, seq: seqOf(event, state.seq) };
}

/**
 * Initial fold state for one session. 'since' starts at the session creation
 * time so a floor rendered from a fresh project has a sane value before the
 * first turn; it is never invented from wall clock at read time.
 * @param {{createdAt?: number} | undefined | null} header
 * @returns {import('../shared/contract.js').CyberAgentState}
 */
export function createCyberAgentState(header) {
  const createdAt = header !== null && typeof header === 'object' && isFiniteNumber(header.createdAt) ? header.createdAt : null;
  return {
    phase: CYBER_PHASE.idle,
    since: createdAt,
    turn: null,
    tool: null,
    approval: null,
    error: null,
    seq: -1,
  };
}

/**
 * Fold one committed session event into the office state machine.
 *
 * Only the six event types below carry a phase transition; everything else
 * (messages, steps, jobs, todos, subagent traffic) returns the input reference.
 * That is intentional: the office reads "tool running" off the unmatched call,
 * "waiting approval" off the unmatched ask, and everything else off turn/start
 * and turn/end.
 *
 * @param {import('../shared/contract.js').CyberAgentState} state
 * @param {any} event
 * @returns {import('../shared/contract.js').CyberAgentState}
 */
export function applyCyberAgent(state, event) {
  if (state === null || typeof state !== 'object') return state;
  if (event === null || typeof event !== 'object') return state;
  const data = event.data !== null && typeof event.data === 'object' ? event.data : undefined;
  switch (event.type) {
    case 'turn/start': {
      return nextState(state, {
        phase: CYBER_PHASE.running,
        since: timeOf(event, state.since),
        turn: isTurnNumber(data?.turn) ? data.turn : state.turn,
        tool: null,
        approval: null,
        error: null,
      }, event);
    }
    case 'tool/call': {
      const name = textOrNull(data?.name, MAX_TOOL_NAME_LENGTH);
      const callId = typeof data?.callId === 'string' && data.callId.length > 0 ? data.callId : null;
      return nextState(state, {
        phase: CYBER_PHASE.tool,
        since: timeOf(event, state.since),
        tool: { name, callId },
      }, event);
    }
    case 'tool/result': {
      // A result is only meaningful against the call it answers; a stale or
      // recovery result must not clear a newer tool (or resurrect a turn that
      // already ended). message.source.callId is the durable pairing key.
      if (state.tool === null) return state;
      const callId = data?.message?.source?.callId;
      if (typeof callId === 'string' && state.tool.callId !== null && state.tool.callId !== callId) return state;
      return nextState(state, {
        phase: CYBER_PHASE.running,
        since: timeOf(event, state.since),
        tool: null,
      }, event);
    }
    case 'approval/asked': {
      const id = typeof data?.id === 'string' && data.id.length > 0 ? data.id : '';
      const toolName = textOrNull(data?.toolName, MAX_TOOL_NAME_LENGTH) ?? '';
      return nextState(state, {
        phase: CYBER_PHASE.waitingApproval,
        since: timeOf(event, state.since),
        approval: { id, toolName, reason: textOrNull(data?.reason, MAX_APPROVAL_REASON_LENGTH) },
      }, event);
    }
    case 'approval/decided': {
      if (state.approval === null) return state;
      const id = typeof data?.id === 'string' ? data.id : null;
      if (id !== null && state.approval.id !== '' && state.approval.id !== id) return state;
      return nextState(state, {
        phase: CYBER_PHASE.running,
        since: timeOf(event, state.since),
        approval: null,
      }, event);
    }
    case 'turn/end': {
      const kind = typeof data?.reason?.kind === 'string' ? data.reason.kind : 'completed';
      const phase = kind === 'error'
        ? CYBER_PHASE.error
        : kind === 'blocked'
          ? CYBER_PHASE.blocked
          : kind === 'aborted'
            ? CYBER_PHASE.idle
            : CYBER_PHASE.done;
      const failure = kind === 'error' ? data.reason?.error : undefined;
      const message = typeof failure === 'string' ? failure : textOrNull(failure?.message, MAX_ERROR_LENGTH);
      return nextState(state, {
        phase,
        since: timeOf(event, state.since),
        turn: isTurnNumber(data?.turn) ? data.turn : state.turn,
        tool: null,
        approval: null,
        error: phase === CYBER_PHASE.error ? (message ?? 'turn failed') : null,
      }, event);
    }
    default:
      // The reference gate: unrelated events do zero downstream work.
      return state;
  }
}

/**
 * Reference-stable wire views. The registry compares raw view references to
 * decide whether to publish a frame, so one state reference must always yield
 * one view reference even when a read recomputes it.
 * @type {WeakMap<object, import('../shared/contract.js').CyberAgentView>}
 */
const wireViews = new WeakMap();

/**
 * Project the fold state onto the browser-visible subset.
 * @param {import('../shared/contract.js').CyberAgentState} state
 * @returns {import('../shared/contract.js').CyberAgentView}
 */
export function cyberAgentView(state) {
  const cached = wireViews.get(state);
  if (cached !== undefined) return cached;
  const tool = state.tool === null || typeof state.tool !== 'object'
    ? null
    : {
        name: typeof state.tool.name === 'string' ? state.tool.name : null,
        callId: typeof state.tool.callId === 'string' ? state.tool.callId : null,
      };
  const approval = state.approval === null || typeof state.approval !== 'object'
    ? null
    : {
        id: typeof state.approval.id === 'string' ? state.approval.id : '',
        toolName: typeof state.approval.toolName === 'string' ? state.approval.toolName : '',
        reason: typeof state.approval.reason === 'string' ? state.approval.reason : null,
      };
  const view = Object.freeze({
    phase: state.phase,
    since: isFiniteNumber(state.since) ? state.since : null,
    turn: isTurnNumber(state.turn) ? state.turn : null,
    tool,
    approval,
    error: typeof state.error === 'string' ? state.error : null,
  });
  wireViews.set(state, view);
  return view;
}

/**
 * The cyberAgent unit registered on ctx.sessionProjections.
 *
 * stateVersion 1 is the persisted-cache gate: changing the phase vocabulary or
 * the meaning of any state field requires a bump, because a cached row from an
 * older build is restored verbatim.
 */
export const cyberAgentProjectionDefinition = Object.freeze({
  key: PROJECTION_KEY,
  stateVersion: PROJECTION_STATE_VERSION,
  stateSchema: passthroughSchema,
  init: (header) => createCyberAgentState(header),
  apply: applyCyberAgent,
  wire: Object.freeze({
    viewSchema: passthroughSchema,
    view: cyberAgentView,
  }),
});

/**
 * Register the unit. Registration is a Cordis effect on the calling fiber, so
 * unloading the plugin removes the key from every served snapshot.
 * @param {{sessionProjections: {register: (definition: any) => unknown}}} ctx
 * @returns {unknown} the registry's disposer
 */
export function registerCyberAgentProjection(ctx) {
  return ctx.sessionProjections.register(cyberAgentProjectionDefinition);
}
