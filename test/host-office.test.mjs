/**
 * Unit tests for host-side floor aggregation.
 *
 * The contract these tests defend is the read budget from research/multi-session.md:
 * a live floor reads the projection registry's host state (no log replay), a cold
 * floor reads the durable projection cache only, and any missing source degrades
 * in the snapshot instead of throwing or falling back to full log replay.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { collectOffice } from '../src/host/office.js';

const ROOT_ID = 'session-root';

test('current-only snapshot reads one cold projection instead of the whole history', async () => {
  let reads = 0;
  const rows = Array.from({ length: 1000 }, (_, i) => ({ header: header('history-' + i), live: false }));
  const ctx = makeCtx({ rows, cache: { cachedSnapshot: () => { reads++; return { values: { agentTeam: wireTeam() } }; } } });
  await collectOffice(ctx, { sessionId: 'history-500' });
  assert.equal(reads, 1000);
  reads = 0;
  const scoped = await collectOffice(ctx, { sessionId: 'history-500', currentOnly: true });
  assert.equal(reads, 1);
  assert.deepEqual(scoped.floors.map(floor => floor.id), ['history-500']);
});

test('current live team bypasses history enumeration and historical projections', async () => {
  let lists = 0, folds = 0;
  const ctx = makeCtx({
    live: new Map([[ROOT_ID, { header: header(ROOT_ID) }]]),
    listSessions: async () => { lists++; throw new Error('must not enumerate history'); },
    stateOf: () => { folds++; return liveTeamState(); },
  });
  const snapshot = await collectOffice(ctx, { sessionId: ROOT_ID, currentOnly: true });
  assert.equal(lists, 0);
  assert.equal(folds, 1);
  assert.equal(snapshot.current.floorId, ROOT_ID);
  assert.equal(snapshot.degraded.sessionQuery, false);
});

test('current-only cold child resolves ancestors without reading other teams', async () => {
  const reads = [];
  const ctx = makeCtx({
    rows: [{ header: header('other') }, { header: header(ROOT_ID) }, { header: header('child', { parentSession: ROOT_ID }) }, { header: header('nested', { parentSession: 'child' }) }],
    cache: { cachedSnapshot: row => { reads.push(row.id); return { values: { agentTeam: wireTeam() } }; } },
  });
  const snapshot = await collectOffice(ctx, { sessionId: 'nested', currentOnly: true });
  assert.deepEqual(reads, [ROOT_ID]);
  assert.deepEqual(snapshot.current, { sessionId: 'nested', floorId: ROOT_ID, isDepartment: true });
});

test('unknown current session cannot fall back to the only live team', async () => {
  let reads = 0;
  const ctx = makeCtx({ rows: [{ header: header(ROOT_ID), live: true }], stateOf: () => { reads++; return liveTeamState(); } });
  const snapshot = await collectOffice(ctx, { sessionId: 'missing', currentOnly: true });
  assert.deepEqual(snapshot.floors, []);
  assert.equal(reads, 0);
});

test('cancelled scoped request stops before reading projection caches', async () => {
  const controller = new AbortController();
  let reads = 0;
  const ctx = makeCtx({
    listSessions: async () => { controller.abort(); return [{ header: header(ROOT_ID) }]; },
    cache: { cachedSnapshot: () => { reads++; } },
  });
  await assert.rejects(collectOffice(ctx, { sessionId: ROOT_ID, currentOnly: true, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(reads, 0);
});

/** Host agentTeam fold state for a three-seat department. */
function liveTeamState(overrides = {}) {
  return {
    id: 'team-' + ROOT_ID,
    members: [
      { id: 'member-dev', name: 'dev', description: 'builds the thing', provider: 'p', context: 'fresh', phase: 'active' },
      { id: 'member-qa', name: 'qa', description: 'breaks the thing', provider: 'p', context: 'fresh', phase: 'provisioning' },
    ],
    tasks: [
      { id: 'task-1', revision: 1, subject: 'done', description: 'done', status: 'completed', blockedBy: [], writeScopes: [] },
      { id: 'task-2', revision: 1, subject: 'busy', description: 'busy', status: 'in_progress', ownerId: 'member-dev', blockedBy: [], writeScopes: [] },
      { id: 'task-3', revision: 1, subject: 'ready', description: 'ready', status: 'pending', blockedBy: ['task-1'], writeScopes: [] },
      { id: 'task-4', revision: 1, subject: 'stuck', description: 'stuck', status: 'pending', blockedBy: ['task-2'], writeScopes: [] },
      { id: 'task-5', revision: 2, subject: 'gone', description: 'gone', status: 'deleted', blockedBy: [], writeScopes: [] },
    ],
    messages: [],
    delivered: [],
    nextTaskNumber: 6,
    ...overrides,
  };
}

/** Client wire view of the same department, as the projection cache stores it. */
function wireTeam(overrides = {}) {
  return {
    members: [
      { id: ROOT_ID, name: 'lead', role: 'lead', phase: 'active' },
      { id: 'member-dev', name: 'dev', role: 'teammate', phase: 'active' },
    ],
    tasks: [
      { id: 'task-1', revision: 1, subject: 'a', description: 'a', status: 'pending', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [] },
    ],
    ...overrides,
  };
}

/** Header for one listed session row. */
function header(id, extra = {}) {
  return { id, createdAt: 100, isSeeded: false, ...extra };
}

/**
 * Build a Context double exposing only the optional services collectOffice reads.
 * Every service can be omitted to exercise one degradation path at a time.
 */
function makeCtx(options = {}) {
  const agents = options.agents ?? [];
  const rows = options.rows ?? [];
  const live = options.live ?? new Map();
  const teams = options.teams === undefined ? {} : options.teams;
  const projections = options.projections === undefined
    ? {
        stateOf: options.stateOf ?? (() => undefined),
        cachedSnapshot: options.liveCachedSnapshot ?? (() => undefined),
      }
    : options.projections;
  const cache = options.cache === undefined ? undefined : options.cache;
  const listSessions = options.listSessions ?? (async () => rows);
  return {
    get(name) {
      switch (name) {
        case 'agentTeams': return teams;
        case 'agents': return options.agentsService === false ? undefined : { list: () => agents };
        case 'sessions': return options.sessionsService === false ? undefined : { get: (id) => live.get(id) };
        case 'sessionProjections': return projections;
        case 'sessionProjectionCache': return cache;
        case 'sessionQuery': return options.sessionQueryService === false ? undefined : { listSessions };
        default: return undefined;
      }
    },
  };
}

test('live department: roster, task counts and runtime statuses', async () => {
  const ctx = makeCtx({
    agents: [
      { id: ROOT_ID, status: 'running' },
      { id: 'member-dev', status: 'running' },
      { id: 'member-qa', status: 'idle' },
    ],
    rows: [{ header: header(ROOT_ID), live: true }],
    live: new Map([[ROOT_ID, { header: header(ROOT_ID) }]]),
    stateOf: () => liveTeamState(),
    liveCachedSnapshot: () => ({ asOfSeq: 2, values: { title: 'Floor One' } }),
  });
  const snapshot = await collectOffice(ctx, { sessionId: ROOT_ID, now: 42 });
  assert.equal(snapshot.asOf, 42);
  assert.equal(snapshot.sampledAt, 42);
  assert.equal(snapshot.v, 1);
  assert.equal(snapshot.state, 'live');
  assert.equal(snapshot.floors.length, 1);
  const floor = snapshot.floors[0];
  assert.equal(floor.id, ROOT_ID);
  assert.equal(floor.kind, 'team');
  assert.equal(floor.title, 'Floor One');
  assert.equal(floor.live, true);
  assert.equal(floor.teamSource, 'live');
  assert.equal(floor.agentAvailable, true);
  assert.equal(floor.running, true);
  assert.equal(floor.memberCount, 3);
  assert.deepEqual(
    floor.members.map((member) => [member.name, member.role, member.status, member.phase, member.description]),
    [
      ['lead', 'lead', 'running', 'active', ''],
      ['dev', 'teammate', 'running', 'active', 'builds the thing'],
      ['qa', 'teammate', 'idle', 'provisioning', 'breaks the thing'],
    ],
  );
  assert.deepEqual(floor.taskCounts, { pending: 2, inProgress: 1, completed: 1, blocked: 1, total: 4 });
  assert.equal(floor.failure, null);
  assert.deepEqual(snapshot.current, { sessionId: ROOT_ID, isDepartment: true, floorId: ROOT_ID });
  assert.equal(snapshot.degraded.teams, false);
});

test('a single-seat session is not a department floor', async () => {
  const ctx = makeCtx({
    agents: [{ id: ROOT_ID, status: 'running' }],
    rows: [{ header: header(ROOT_ID), live: true }],
    live: new Map([[ROOT_ID, { header: header(ROOT_ID) }]]),
    stateOf: () => liveTeamState({ members: [], tasks: [] }),
  });
  const snapshot = await collectOffice(ctx, { sessionId: ROOT_ID });
  assert.deepEqual(snapshot.floors, []);
  assert.deepEqual(snapshot.current, { sessionId: ROOT_ID, isDepartment: false, floorId: null });
});

test('a session whose projection is absent is not a floor', async () => {
  const ctx = makeCtx({
    agents: [{ id: ROOT_ID, status: 'running' }],
    rows: [{ header: header(ROOT_ID), live: true }],
    live: new Map([[ROOT_ID, { header: header(ROOT_ID) }]]),
    stateOf: () => undefined,
  });
  const snapshot = await collectOffice(ctx, { sessionId: ROOT_ID });
  assert.deepEqual(snapshot.floors, []);
});

test('cold department: the projection cache is the only read and members are inactive', async () => {
  const cacheCalls = [];
  const coldId = 'session-cold';
  const ctx = makeCtx({
    agents: [],
    rows: [{ header: header(coldId), live: false }],
    cache: {
      cachedSnapshot(sessionHeader, keys) {
        cacheCalls.push([sessionHeader.id, keys]);
        return { asOfSeq: 9, values: { title: 'Cold Floor', agentTeam: wireTeam() } };
      },
    },
  });
  const snapshot = await collectOffice(ctx, { sessionId: coldId });
  assert.deepEqual(cacheCalls, [[coldId, ['title', 'agentTeam']]]);
  assert.equal(snapshot.floors.length, 1);
  const floor = snapshot.floors[0];
  assert.equal(floor.title, 'Cold Floor');
  assert.equal(floor.teamSource, 'cached');
  assert.equal(floor.live, false);
  assert.equal(floor.agentAvailable, false);
  assert.equal(floor.running, false);
  assert.equal(floor.memberCount, 2);
  assert.deepEqual(floor.members.map((member) => [member.name, member.status, member.agentAvailable]), [
    ['lead', 'inactive', false],
    ['dev', 'inactive', false],
  ]);
  assert.deepEqual(floor.taskCounts, { pending: 1, inProgress: 0, completed: 0, blocked: 0, total: 1 });
});

test('cold rows never touch the live projection registry', async () => {
  const ctx = makeCtx({
    rows: [{ header: header('session-cold'), live: false }],
    stateOf: () => { throw new Error('cold rows must not fold logs'); },
    cache: { cachedSnapshot: () => ({ asOfSeq: 1, values: { agentTeam: wireTeam() } }) },
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.floors.length, 1);
});

test('child sessions (teammates/subagents) are never floors', async () => {
  const cacheCalls = [];
  const ctx = makeCtx({
    rows: [
      { header: header('child', { parentSession: ROOT_ID }), live: false },
      { header: header('sub', { parentSession: ROOT_ID, origin: 'subagent' }), live: false },
    ],
    cache: { cachedSnapshot: (entry) => { cacheCalls.push(entry.id); return { values: { agentTeam: wireTeam() } }; } },
  });
  const snapshot = await collectOffice(ctx, {});
  assert.deepEqual(snapshot.floors, []);
  assert.deepEqual(cacheCalls, []);
});

test('missing Agent Teams degrades the snapshot instead of failing it', async () => {
  const ctx = makeCtx({
    teams: null,
    rows: [{ header: header('session-cold'), live: false }],
    cache: { cachedSnapshot: () => ({ asOfSeq: 1, values: { agentTeam: wireTeam() } }) },
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.degraded.teams, true);
  assert.equal(snapshot.state, 'degraded');
  assert.ok(snapshot.degraded.reasons.includes('agent-teams-unavailable'));
  // A historically recorded team is still visible as a dormant floor.
  assert.equal(snapshot.floors.length, 1);
  assert.equal(snapshot.floors[0].live, false);
});

test('a failing session list degrades to live agents', async () => {
  const session = { header: header(ROOT_ID) };
  const ctx = makeCtx({
    agents: [{ id: ROOT_ID, status: 'running', session }],
    listSessions: async () => { throw new Error('persistence unavailable'); },
    stateOf: () => liveTeamState(),
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.degraded.sessionQuery, true);
  assert.equal(snapshot.state, 'degraded');
  assert.ok(snapshot.degraded.reasons.includes('session-list-failed'));
  assert.equal(snapshot.floors.length, 1);
  assert.equal(snapshot.floors[0].id, ROOT_ID);
  assert.equal(snapshot.floors[0].teamSource, 'live');
});

test('a missing session query service is reported, not thrown', async () => {
  const ctx = makeCtx({
    sessionQueryService: false,
    agents: [{ id: ROOT_ID, status: 'idle', session: { header: header(ROOT_ID) } }],
    stateOf: () => liveTeamState(),
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.degraded.sessionQuery, true);
  assert.ok(snapshot.degraded.reasons.includes('session-query-unavailable'));
  assert.equal(snapshot.floors.length, 1);
});

test('a cold row without a projection cache marks the snapshot degraded', async () => {
  const ctx = makeCtx({ rows: [{ header: header('session-cold'), live: false }] });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.degraded.projectionCache, true);
  assert.ok(snapshot.degraded.reasons.includes('projection-cache-unavailable'));
  assert.deepEqual(snapshot.floors, []);
});

test('a projection fold failure is contained to its floor', async () => {
  const ctx = makeCtx({
    agents: [{ id: ROOT_ID, status: 'running' }, { id: 'session-other', status: 'running' }],
    rows: [
      { header: header(ROOT_ID), live: true },
      { header: header('session-other'), live: true },
    ],
    live: new Map([
      [ROOT_ID, { header: header(ROOT_ID) }],
      ['session-other', { header: header('session-other') }],
    ]),
    stateOf: (session) => {
      if (session.header.id === ROOT_ID) throw new Error('corrupt log');
      return liveTeamState();
    },
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.floors.length, 1);
  assert.equal(snapshot.floors[0].id, 'session-other');
  assert.equal(snapshot.degraded.reasons.filter((reason) => reason === 'projection-fold-failed').length, 1);
});

test('an unsupported session format skips the cold row', async () => {
  const ctx = makeCtx({
    rows: [{ header: header('session-legacy'), live: false, formatStatus: 'legacy' }],
    cache: { cachedSnapshot: () => { throw new Error('must not be read'); } },
  });
  const snapshot = await collectOffice(ctx, {});
  assert.deepEqual(snapshot.floors, []);
  assert.ok(snapshot.degraded.reasons.includes('format-legacy'));
});

test('the requested floor sorts first and current mirrors it', async () => {
  const older = 'session-older';
  const newer = 'session-newer';
  const ctx = makeCtx({
    agents: [
      { id: older, status: 'idle' },
      { id: newer, status: 'running' },
    ],
    rows: [
      { header: header(newer, { createdAt: 900 }), live: true },
      { header: header(older, { createdAt: 100 }), live: true },
    ],
    live: new Map([
      [older, { header: header(older) }],
      [newer, { header: header(newer) }],
    ]),
    stateOf: () => liveTeamState(),
  });
  const snapshot = await collectOffice(ctx, { sessionId: older });
  assert.deepEqual(snapshot.floors.map((floor) => floor.id), [older, newer]);
  assert.deepEqual(snapshot.current, { sessionId: older, isDepartment: true, floorId: older });
});

test('without a requested session nothing is marked current', async () => {
  const ctx = makeCtx({
    agents: [{ id: ROOT_ID, status: 'running' }],
    rows: [{ header: header(ROOT_ID), live: true }],
    live: new Map([[ROOT_ID, { header: header(ROOT_ID) }]]),
    stateOf: () => liveTeamState(),
  });
  const snapshot = await collectOffice(ctx, {});
  assert.deepEqual(snapshot.current, { sessionId: null, isDepartment: false, floorId: null });
  assert.equal(snapshot.floors.length, 1);
});

test('a team projection failure is surfaced on the floor', async () => {
  const ctx = makeCtx({
    agents: [{ id: ROOT_ID, status: 'running' }],
    rows: [{ header: header(ROOT_ID), live: true }],
    live: new Map([[ROOT_ID, { header: header(ROOT_ID) }]]),
    stateOf: () => liveTeamState({ failure: 'roster event rejected' }),
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.floors[0].failure, 'roster event rejected');
});

test('a missing agents service is reported but floors still come from the log', async () => {
  const ctx = makeCtx({
    agentsService: false,
    rows: [{ header: header(ROOT_ID), live: true }],
    live: new Map([[ROOT_ID, { header: header(ROOT_ID) }]]),
    stateOf: () => liveTeamState(),
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.degraded.agents, true);
  assert.ok(snapshot.degraded.reasons.includes('agents-unavailable'));
  assert.equal(snapshot.floors.length, 1);
  assert.equal(snapshot.floors[0].agentAvailable, false);
  assert.equal(snapshot.floors[0].running, false);
  assert.deepEqual(snapshot.floors[0].members.map((member) => member.status), ['inactive', 'inactive', 'inactive']);
});

test('an unenumerable host reports the snapshot as unavailable', async () => {
  const ctx = makeCtx({
    agentsService: false,
    sessionQueryService: false,
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.state, 'unavailable');
  assert.deepEqual(snapshot.floors, []);
  assert.deepEqual(snapshot.current, { sessionId: null, isDepartment: false, floorId: null });
});

test('cwd is carried through for clients that fall back to a path label', async () => {
  const ctx = makeCtx({
    agents: [{ id: ROOT_ID, status: 'running' }],
    rows: [{ header: header(ROOT_ID, { cwd: 'F:\\Deepseek' }), live: true }],
    live: new Map([[ROOT_ID, { header: header(ROOT_ID) }]]),
    stateOf: () => liveTeamState(),
  });
  const snapshot = await collectOffice(ctx, {});
  assert.equal(snapshot.floors[0].cwd, 'F:\\Deepseek');
  assert.equal(snapshot.floors[0].title, null);
});
