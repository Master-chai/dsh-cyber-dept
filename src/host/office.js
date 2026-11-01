/**
 * Host-side floor aggregation for the office view.
 *
 * One snapshot request answers "which departments exist right now, who sits in
 * them, and how busy are they?" without a single log replay per floor:
 *
 * - the Session list is the one unavoidable persistence read (headers only);
 * - a LIVE root session reads the already-materialized agentTeam state through
 *   ctx.sessionProjections.stateOf (lazy fold over the in-memory log, no I/O);
 * - a COLD root session reads the durable projection cache
 *   (sessionProjectionCache.cachedSnapshot), which serves wire keys straight
 *   from its stored rows and is never older than one checkpoint.
 *
 * A floor is a department only when its roster has more than one member (the
 * implicit Lead plus at least one teammate). Every ordinary one-agent session
 * would otherwise become an empty floor, which is exactly the failure mode
 * PLAN-v0.2 section 2 calls out.
 *
 * @module dsh-cyber-dept/host/office
 */
import { AGENT_TEAM_KEY, MAX_DEGRADED_REASONS, MEMBER_STATUS, OFFICE_STATE } from '../shared/contract.js';

/**
 * Keys the cold path may ask the projection cache for. Both are native wire
 * keys: the floor's display title and the Agent Teams roster/task view. The
 * plugin's own cyberAgent key is deliberately NOT requested here - a floor
 * summary does not need it, and every extra key is schema work per row.
 */
const COLD_KEYS = Object.freeze(['title', AGENT_TEAM_KEY]);
/** Keys the live zero-fold path may ask the registry's cached cells for. */
const TITLE_KEYS = Object.freeze(['title']);

import { historyFor } from './history-cache.js';
export { createOfficeHistoryCache, invalidateOfficeHistory } from './history-cache.js';

function tasksForSnapshot(team) {
  const source = Array.isArray(team?.tasks) ? team.tasks : [];
  const completed = new Set(source.filter(t => t?.status === 'completed').map(t => t.id));
  return source.filter(t => t && typeof t.id === 'string').map(task => ({
    id: task.id, revision: task.revision, subject: task.subject, description: task.description,
    status: task.status, ownerId: task.ownerId, ownerName: task.ownerName,
    blockedBy: task.blockedBy || [], writeScopes: task.writeScopes || [],
    ready: task.status === 'pending' && (typeof task.ready === 'boolean' ? task.ready : (task.blockedBy || []).every(id => completed.has(id))),
    writeScopeWarnings: task.writeScopeWarnings || [],
  }));
}

/**
 * Read an optional Cordis service without letting a composition failure escape
 * into the snapshot. ctx.get is the documented optional-service read and never
 * throws for an unloaded service, but a broken composition should still degrade
 * instead of failing the whole route.
 * @param {any} ctx
 * @param {string} name
 * @returns {any}
 */
function getService(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Map a live Agent onto the office status vocabulary. Absence of an Agent is
 * 'inactive', never 'idle': a dormant teammate must not look like a finished
 * turn (agent-activity-signals.md section 5).
 * @param {any} agent
 * @returns {{status: import('../shared/contract.js').MemberStatus, agentAvailable: boolean}}
 */
function statusOf(agent) {
  if (agent === undefined || agent === null) return { status: MEMBER_STATUS.inactive, agentAvailable: false };
  return {
    status: agent.status === 'running' ? MEMBER_STATUS.running : MEMBER_STATUS.idle,
    agentAvailable: true,
  };
}

/** @param {unknown} value */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether 'team' is the host fold state ({id, members, tasks, messages, ...})
 * rather than the client wire view ({members, tasks, failure?}). The state's
 * teammates carry 'description' and no 'role'; the wire view's members carry
 * 'role' and start with the implicit Lead.
 * @param {any} team
 * @returns {boolean}
 */
function isTeamState(team) {
  if (typeof team?.id !== 'string' || !Array.isArray(team?.members)) return false;
  return !team.members.some((member) => member?.role === 'lead' || member?.role === 'teammate');
}

/**
 * One Lead row. The Lead has no durable member record of its own - the Team id
 * IS the Lead session id - so the office synthesizes the row from the floor
 * identity, exactly as the native client view does.
 * @param {string} rootId
 * @param {Map<string, any>} agentsById
 * @returns {import('../shared/contract.js').OfficeMember}
 */
function leadRow(rootId, agentsById) {
  const { status, agentAvailable } = statusOf(agentsById.get(rootId));
  return {
    id: rootId,
    name: 'lead',
    role: 'lead',
    phase: 'active',
    status,
    agentAvailable,
    description: '',
    error: null,
  };
}

/**
 * One teammate row from either source shape, enriched with runtime status.
 * @param {any} member
 * @param {Map<string, any>} agentsById
 * @returns {import('../shared/contract.js').OfficeMember}
 */
function teammateRow(member, agentsById) {
  const id = typeof member?.id === 'string' ? member.id : '';
  const { status, agentAvailable } = statusOf(agentsById.get(id));
  const phase = member?.phase === 'provisioning' || member?.phase === 'failed' || member?.phase === 'active'
    ? member.phase
    : 'active';
  return {
    id,
    name: typeof member?.name === 'string' ? member.name : '',
    role: 'teammate',
    phase,
    status,
    agentAvailable,
    description: typeof member?.description === 'string' ? member.description : '',
    error: typeof member?.error === 'string' ? member.error : null,
  };
}

/**
 * Normalize either team shape into a Lead-first roster.
 * @param {any} team
 * @param {string} rootId
 * @param {Map<string, any>} agentsById
 * @returns {import('../shared/contract.js').OfficeMember[]}
 */
function normalizeMembers(team, rootId, agentsById) {
  const members = [];
  if (isTeamState(team)) {
    members.push(leadRow(rootId, agentsById));
    for (const member of team.members) members.push(teammateRow(member, agentsById));
    return members;
  }
  for (const member of Array.isArray(team?.members) ? team.members : []) {
    if (member?.role === 'lead') members.push(leadRow(typeof member.id === 'string' ? member.id : rootId, agentsById));
    else members.push(teammateRow(member, agentsById));
  }
  if (!members.some((member) => member.role === 'lead')) members.unshift(leadRow(rootId, agentsById));
  return members;
}

/**
 * Summarize the task board. Only non-deleted tasks count; 'blocked' counts
 * pending tasks with at least one unfinished dependency, which is what the
 * office renders as "waiting on a blocker" rather than "idle".
 * @param {any} team
 * @returns {import('../shared/contract.js').OfficeTaskCounts}
 */
function taskCountsOf(team) {
  const counts = { pending: 0, inProgress: 0, completed: 0, blocked: 0, total: 0 };
  const tasks = Array.isArray(team?.tasks) ? team.tasks : [];
  const completed = new Set();
  for (const task of tasks) {
    if (task?.status === 'completed' && typeof task.id === 'string') completed.add(task.id);
  }
  for (const task of tasks) {
    if (task === null || typeof task !== 'object' || task.status === 'deleted') continue;
    counts.total += 1;
    if (task.status === 'in_progress') counts.inProgress += 1;
    else if (task.status === 'completed') counts.completed += 1;
    else if (task.status === 'pending') {
      counts.pending += 1;
      const ready = typeof task.ready === 'boolean'
        ? task.ready
        : (Array.isArray(task.blockedBy) ? task.blockedBy : []).every((id) => completed.has(id));
      if (!ready) counts.blocked += 1;
    }
  }
  return counts;
}

/**
 * The live Session object for one floor. ctx.sessions owns attached sessions and
 * the Agent registry is the fallback for compositions that do not expose it.
 * @param {any} sessionsService
 * @param {any} agent
 * @param {string} sessionId
 * @returns {any}
 */
function resolveLiveSession(sessionsService, agent, sessionId) {
  try {
    const session = typeof sessionsService?.get === 'function' ? sessionsService.get(sessionId) : undefined;
    if (session !== undefined && session !== null) return session;
  } catch {
    /* fall through to the agent's own session */
  }
  return agent?.session;
}

/**
 * Enumerate fallback rows when the Session list is unavailable: the live agents
 * are still a truthful (if partial) floor index.
 * @param {any[]} agents
 * @returns {{header: any, live: boolean}[]}
 */
function rowsFromAgents(agents) {
  const rows = [];
  for (const agent of agents) {
    if (agent === null || typeof agent !== 'object' || typeof agent.id !== 'string') continue;
    const header = agent.session?.header;
    rows.push({
      header: header !== null && typeof header === 'object' ? header : { id: agent.id, createdAt: 0, isSeeded: false },
      live: true,
    });
  }
  return rows;
}

/**
 * Collect the office snapshot: department floors only, the current floor marker,
 * and an explicit degradation record instead of a thrown error.
 *
 * @param {any} ctx - Cordis context carrying connection/sessionProjections/sessionQuery/agents.
 * @param {{sessionId?: string | null, currentOnly?: boolean, signal?: AbortSignal, now?: number}} [options]
 * @returns {Promise<import('../shared/contract.js').OfficeSnapshot>}
 */
export async function collectOffice(ctx, options = {}) {
  const requested = typeof options.sessionId === 'string' && options.sessionId.length > 0
    ? options.sessionId.slice(0, 256)
    : null;
  const now = isFiniteNumber(options.now) ? options.now : Date.now();
  const degraded = { teams: false, projectionCache: false, sessionQuery: false, agents: false, projection: false, reasons: [] };
  /**
   * @param {string} reason
   */
  const note = (reason) => {
    if (degraded.reasons.length >= MAX_DEGRADED_REASONS || degraded.reasons.includes(reason)) return;
    degraded.reasons.push(reason);
  };

  const teams = getService(ctx, 'agentTeams');
  if (teams === undefined || teams === null) {
    degraded.teams = true;
    note('agent-teams-unavailable');
  }

  const agentsService = getService(ctx, 'agents');
  let agents = [];
  if (agentsService !== undefined && agentsService !== null && typeof agentsService.list === 'function') {
    try {
      const listed = agentsService.list();
      if (Array.isArray(listed)) agents = listed;
    } catch {
      degraded.agents = true;
      note('agents-unavailable');
    }
  } else {
    degraded.agents = true;
    note('agents-unavailable');
  }
  /** @type {Map<string, any>} */
  const agentsById = new Map();
  for (const agent of agents) {
    if (agent !== null && typeof agent === 'object' && typeof agent.id === 'string' && !agentsById.has(agent.id)) {
      agentsById.set(agent.id, agent);
    }
  }

  const projections = getService(ctx, 'sessionProjections');
  const projectionCache = getService(ctx, 'sessionProjectionCache');
  const sessionsService = getService(ctx, 'sessions');
  const queryService = getService(ctx, 'sessionQuery');

  /** @type {{header: any, live?: boolean, formatStatus?: string}[]} */
  let rows;
  let resolvedLiveRoot = null;
  // Sidebar requests need one department. Attached sessions already carry their
  // headers, so a live conversation need not enumerate persisted history at all.
  if (options.currentOnly && requested) {
    let id = requested;
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const session = resolveLiveSession(sessionsService, agentsById.get(id), id);
      const header = session?.header;
      if (header?.id !== id) break;
      if (header.parentSession === undefined) { rows = [{ header, live: true }]; resolvedLiveRoot = id; break; }
      id = typeof header.parentSession === 'string' ? header.parentSession : null;
    }
  }
  if (rows === undefined && queryService !== undefined && queryService !== null && typeof queryService.listSessions === 'function') {
    try {
      const listed = options.currentOnly ? await historyFor(ctx).read(queryService, options.signal) : await queryService.listSessions(options.signal);
      rows = Array.isArray(listed) ? listed : [];
    } catch {
      degraded.sessionQuery = true;
      note('session-list-failed');
      rows = rowsFromAgents(agents);
    }
  } else if (rows === undefined) {
    degraded.sessionQuery = true;
    note('session-query-unavailable');
    rows = rowsFromAgents(agents);
  }

  options.signal?.throwIfAborted();
  let requestedRoot = requested;
  if (options.currentOnly) {
    const byId = new Map(rows.map((row) => [row?.header?.id, row]));
    // The live fast path may already have resolved a child to its attached root.
    if (resolvedLiveRoot) requestedRoot = resolvedLiveRoot;
    const seen = new Set();
    while (requestedRoot && !seen.has(requestedRoot)) {
      seen.add(requestedRoot);
      const row = byId.get(requestedRoot);
      if (!row) { requestedRoot = null; break; }
      if (row.header.parentSession === undefined) break;
      requestedRoot = typeof row.header.parentSession === 'string' ? row.header.parentSession : null;
    }
    const selected = requestedRoot && byId.get(requestedRoot);
    rows = selected && selected.header.parentSession === undefined ? [selected] : [];
  }

  /** @type {import('../shared/contract.js').OfficeFloor[]} */
  const floors = [];
  for (const row of rows) {
    options.signal?.throwIfAborted();
    const header = row?.header;
    if (header === null || typeof header !== 'object') continue;
    if (typeof header.id !== 'string' || header.id.length === 0) continue;
    // A department floor is a Team root. Teammates and subagents are children of
    // a root session and appear as seats on that floor, never as floors of their own.
    if (header.parentSession !== undefined) continue;
    const live = row.live === true;
    if (!live && typeof row.formatStatus === 'string' && row.formatStatus !== 'current') {
      note('format-' + row.formatStatus);
      continue;
    }
    const agent = agentsById.get(header.id);
    let team = null;
    let teamSource = null;
    let title = null;

    if (live) {
      const session = resolveLiveSession(sessionsService, agent, header.id);
      if (session !== undefined && session !== null && projections !== null && projections !== undefined && typeof projections.stateOf === 'function') {
        try {
          const state = projections.stateOf(session, AGENT_TEAM_KEY);
          if (state !== null && state !== undefined) {
            team = state;
            teamSource = 'live';
          }
        } catch {
          degraded.projection = true;
          note('projection-fold-failed');
        }
        try {
          const block = typeof projections.cachedSnapshot === 'function' ? projections.cachedSnapshot(session, TITLE_KEYS) : undefined;
          const value = block?.values?.title;
          if (typeof value === 'string' && value.length > 0) title = value;
        } catch {
          /* title is optional decoration */
        }
      }
    } else if (projectionCache !== null && projectionCache !== undefined && typeof projectionCache.cachedSnapshot === 'function') {
      try {
        const block = projectionCache.cachedSnapshot(header, COLD_KEYS);
        const values = block?.values;
        const cachedTitle = values?.title;
        if (typeof cachedTitle === 'string' && cachedTitle.length > 0) title = cachedTitle;
        if (values?.[AGENT_TEAM_KEY] !== undefined && values?.[AGENT_TEAM_KEY] !== null) {
          team = values[AGENT_TEAM_KEY];
          teamSource = 'cached';
        }
      } catch {
        degraded.projectionCache = true;
        note('cache-read-failed');
      }
    } else {
      degraded.projectionCache = true;
      note('projection-cache-unavailable');
    }

    if (team === null || teamSource === null) continue;
    const members = normalizeMembers(team, header.id, agentsById);
    // Ordinary sessions are not departments (PLAN-v0.2 section 2).
    if (members.length <= 1) continue;
    floors.push({
      id: header.id,
      // Every returned floor IS a department: a one-seat session never gets here.
      kind: 'team',
      title,
      cwd: typeof header.cwd === 'string' ? header.cwd : null,
      live,
      agentAvailable: agent !== undefined && agent !== null,
      running: agent?.status === 'running',
      teamSource,
      memberCount: members.length,
      members,
      tasks: tasksForSnapshot(team),
      taskCounts: taskCountsOf(team),
      failure: typeof team.failure === 'string' && team.failure.length > 0 ? team.failure : null,
      createdAt: isFiniteNumber(header.createdAt) ? header.createdAt : null,
    });
  }

  // Current floor first, then live departments, then the most recently created;
  // ties break on id so two snapshots agree on ordering.
  floors.sort((left, right) => {
    const leftCurrent = left.id === requested ? 1 : 0;
    const rightCurrent = right.id === requested ? 1 : 0;
    if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;
    if (left.live !== right.live) return left.live ? -1 : 1;
    const leftCreated = left.createdAt ?? 0;
    const rightCreated = right.createdAt ?? 0;
    if (leftCreated !== rightCreated) return rightCreated - leftCreated;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const currentFloor = requestedRoot === null ? undefined : floors.find((floor) => floor.id === requestedRoot);
  const failed = degraded.teams || degraded.projectionCache || degraded.sessionQuery || degraded.agents || degraded.projection;
  const state = !failed
    ? OFFICE_STATE.live
    : floors.length === 0 && (degraded.sessionQuery || degraded.agents)
      ? OFFICE_STATE.unavailable
      : OFFICE_STATE.degraded;
  return {
    // Envelope fields a client uses to label the snapshot; asOf/sampledAt carry
    // the same instant so either name reads truthfully.
    v: 1,
    state,
    sampledAt: now,
    asOf: now,
    floors,
    current: {
      sessionId: requested,
      isDepartment: currentFloor !== undefined,
      floorId: currentFloor?.id ?? null,
    },
    degraded,
  };
}
