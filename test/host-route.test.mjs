/**
 * Route-layer integration tests: the two native Connection Fetch routes as they
 * are actually mounted by index.js apply().
 *
 * host-office / host-command / host-projection cover their modules in isolation;
 * this file is the seam test. It asserts that
 *
 * - apply() registers the cyberAgent projection and both routes on the plugin
 *   fiber (the only place wiring can silently rot);
 * - the snapshot route speaks the pulled envelope contract end to end: 400 only
 *   for a malformed envelope, 200 server-response with floors/current/degraded/
 *   asOf otherwise, cache-control: no-store on every answer;
 * - a collectOffice() escape is contained into a 200 domain failure instead of
 *   throwing out of the Fetch handler;
 * - registerOfficeRoutes() shares one CommandLedger across the pair, so a
 *   commandId replay crosses the route rather than re-calling the Team service.
 *
 * Everything is a fake Cordis context: no profile, no host process, no Team.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { apply, inject, name } from '../index.js';
import { readSnapshotEnvelope, registerOfficeRoutes, registerSnapshotRoute } from '../src/host/route.js';
import {
  CLIENT_REQUEST,
  COMMAND_METHOD,
  COMMAND_ROUTE,
  PROJECTION_KEY,
  PROJECTION_STATE_VERSION,
  SNAPSHOT_METHOD,
  SNAPSHOT_ROUTE,
  SERVER_RESPONSE,
} from '../src/shared/contract.js';

const SESSION_ID = 'session-live-root';
const UUID = () => randomUUID();

test('snapshot scope is opt-in and requires a concrete session', () => {
  assert.deepEqual(readSnapshotEnvelope(snapshotEnvelope({ sessionId: SESSION_ID, currentOnly: true })).payload, { sessionId: SESSION_ID, currentOnly: true });
  assert.equal(readSnapshotEnvelope(snapshotEnvelope({ currentOnly: true })).ok, false);
  assert.equal(readSnapshotEnvelope(snapshotEnvelope({ sessionId: SESSION_ID, currentOnly: 'yes' })).ok, false);
});

/** One team fold state as ctx.sessionProjections.stateOf returns it (no lead row). */
function teamState(rootId, teammates, tasks = []) {
  return {
    id: rootId,
    members: teammates.map((member) => ({
      id: member.id,
      name: member.name,
      description: member.description ?? '',
      provider: 'spawn',
      context: 'fresh',
      phase: member.phase ?? 'active',
    })),
    tasks,
    messages: [],
    delivered: [],
    nextTaskNumber: 1,
  };
}

/** A task record in host-fold shape (what the office summarizes). */
function task(id, status, extra = {}) {
  return {
    id,
    revision: 1,
    subject: 'subject ' + id,
    description: '',
    status,
    blockedBy: [],
    writeScopes: [],
    ...extra,
  };
}

/** Recording Connection service (the only surface register* touches). */
function makeConnection() {
  const routes = [];
  return {
    routes,
    fetch: {
      register(route) {
        let disposed = false;
        routes.push({ route, isDisposed: () => disposed });
        return () => {
          disposed = true;
        };
      },
    },
  };
}

/**
 * A live Team root: one Agent, one attached Session, one agentTeam fold state.
 */
function makeHost(overrides = {}) {
  const connection = makeConnection();
  const header = { id: SESSION_ID, version: 4, createdAt: 1_700_000_000_000, isSeeded: false };
  const session = { header };
  const agent = { id: SESSION_ID, status: 'running', session };
  const teammates = [
    { id: 'session-ada', name: 'ada', description: 'builds the host layer' },
    { id: 'session-linus', name: 'linus', description: 'reviews the routes' },
  ];
  const tasks = [
    task('task-1', 'pending'),
    task('task-2', 'in_progress', { ownerId: 'session-ada' }),
    task('task-3', 'completed'),
    task('task-4', 'pending', { blockedBy: ['task-2'] }),
  ];
  const services = {
    connection,
    agentTeams: {},
    agents: { list: () => [agent], get: (id) => (id === SESSION_ID ? agent : undefined) },
    sessionQuery: { listSessions: async () => [{ header, live: true, formatStatus: 'current' }] },
    sessionProjections: {
      stateOf: (target, key) => (key === 'agentTeam' ? teamState(SESSION_ID, teammates, tasks) : undefined),
      cachedSnapshot: () => ({ asOfSeq: 3, values: {} }),
    },
    sessions: { get: () => session },
    ...overrides.services,
  };
  return {
    connection,
    header,
    session,
    agent,
    teammates,
    tasks,
    ctx: {
      get: (name) => services[name],
      connection,
      logger: { warn() {} },
      ...overrides.ctx,
    },
  };
}

/** POST one envelope body (raw text) to a registered route. */
async function post(route, body) {
  const request = new Request('http://127.0.0.1' + route.path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return await route.fetch(request);
}

/** A valid snapshot envelope. */
function snapshotEnvelope(payload = { sessionId: SESSION_ID }, rpcId = 'rpc-1') {
  return { type: CLIENT_REQUEST, rpcId, method: SNAPSHOT_METHOD, payload };
}

/** A valid command envelope. */
function commandEnvelope(commandId, action, args, sessionId = SESSION_ID) {
  return {
    type: CLIENT_REQUEST,
    rpcId: 'rpc-' + commandId,
    method: COMMAND_METHOD,
    payload: { commandId, sessionId, action, args },
  };
}

// #region wiring

test('apply: registers the cyberAgent projection and both office routes', () => {
  const host = makeHost();
  const registered = [];
  host.ctx.sessionProjections = {
    register(definition) {
      registered.push(definition);
      return () => {};
    },
  };
  apply(host.ctx);
  assert.equal(registered.length, 1, 'one projection registration');
  assert.equal(registered[0].key, PROJECTION_KEY);
  assert.equal(registered[0].stateVersion, PROJECTION_STATE_VERSION);
  assert.equal(typeof registered[0].apply, 'function');
  assert.equal(registered[0].wire.viewSchema.parse({ phase: 'idle' }).phase, 'idle');
  assert.deepEqual(
    host.connection.routes.map((entry) => entry.route.path),
    [SNAPSHOT_ROUTE, COMMAND_ROUTE],
  );
});

test('index: exports the plugin name and required inject list', () => {
  assert.equal(name, 'dsh-cyber-dept');
  assert.deepEqual(inject, ['connection', 'sessionProjections', 'sessionQuery', 'agents']);
});

test('registerOfficeRoutes: one disposer tears both routes down', () => {
  const host = makeHost();
  const dispose = registerOfficeRoutes(host.ctx);
  assert.equal(host.connection.routes.length, 2);
  dispose();
  assert.ok(host.connection.routes.every((entry) => entry.isDisposed()));
});

test('registerSnapshotRoute: declares the contracted path, method and buffered body', () => {
  const host = makeHost();
  registerSnapshotRoute(host.ctx);
  const [entry] = host.connection.routes;
  assert.equal(entry.route.path, SNAPSHOT_ROUTE);
  assert.deepEqual(entry.route.methods, ['POST']);
  assert.equal(entry.route.requestBody, 'buffered');
});

// #endregion
// #region snapshot envelope

test('snapshot envelope: accepts a sessionId and normalizes a missing one', () => {
  assert.deepEqual(readSnapshotEnvelope(snapshotEnvelope()), {
    ok: true,
    rpcId: 'rpc-1',
    payload: { sessionId: SESSION_ID },
  });
  assert.deepEqual(readSnapshotEnvelope(snapshotEnvelope({})), {
    ok: true,
    rpcId: 'rpc-1',
    payload: { sessionId: null },
  });
  assert.deepEqual(readSnapshotEnvelope(snapshotEnvelope({ sessionId: null })), {
    ok: true,
    rpcId: 'rpc-1',
    payload: { sessionId: null },
  });
});

test('snapshot envelope: rejects non-envelopes and wrong discriminators', () => {
  assert.equal(readSnapshotEnvelope(null).reason, 'envelope-not-object');
  assert.equal(readSnapshotEnvelope('x').reason, 'envelope-not-object');
  assert.equal(readSnapshotEnvelope({}).reason, 'envelope-type');
  assert.equal(readSnapshotEnvelope({ type: 'server-response', rpcId: 'r', method: SNAPSHOT_METHOD, payload: {} }).reason, 'envelope-type');
  assert.equal(readSnapshotEnvelope({ type: CLIENT_REQUEST, rpcId: '', method: SNAPSHOT_METHOD, payload: {} }).reason, 'envelope-rpc-id');
  assert.equal(readSnapshotEnvelope({ type: CLIENT_REQUEST, rpcId: 'r'.repeat(257), method: SNAPSHOT_METHOD, payload: {} }).reason, 'envelope-rpc-id');
  assert.equal(readSnapshotEnvelope({ type: CLIENT_REQUEST, rpcId: 'r', method: 'cyberOffice/command', payload: {} }).reason, 'envelope-method');
  assert.equal(readSnapshotEnvelope({ type: CLIENT_REQUEST, rpcId: 'r', method: SNAPSHOT_METHOD }).reason, 'payload-not-object');
  assert.equal(readSnapshotEnvelope(snapshotEnvelope({ foo: 1 })).reason, 'unexpected-payload-key:foo');
  assert.equal(readSnapshotEnvelope(snapshotEnvelope({ sessionId: '' })).reason, 'payload-session-id');
  assert.equal(readSnapshotEnvelope(snapshotEnvelope({ sessionId: 's'.repeat(257) })).reason, 'payload-session-id');
  assert.equal(readSnapshotEnvelope(snapshotEnvelope({ sessionId: 42 })).reason, 'payload-session-id');
});

// #endregion
// #region snapshot route

test('snapshot route: a live department is answered as one server-response', async () => {
  const host = makeHost();
  registerSnapshotRoute(host.ctx);
  const response = await post(host.connection.routes[0].route, snapshotEnvelope());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.type, SERVER_RESPONSE);
  assert.equal(body.rpcId, 'rpc-1');
  assert.equal(body.result.ok, true);
  const value = body.result.value;
  assert.ok(Array.isArray(value.floors));
  assert.equal(value.floors.length, 1);
  const floor = value.floors[0];
  assert.equal(floor.id, SESSION_ID);
  assert.equal(floor.live, true);
  assert.equal(floor.running, true);
  assert.equal(floor.teamSource, 'live');
  assert.equal(floor.memberCount, 3);
  assert.deepEqual(floor.members.map((member) => [member.name, member.role]), [
    ['lead', 'lead'],
    ['ada', 'teammate'],
    ['linus', 'teammate'],
  ]);
  assert.deepEqual(floor.members[0].status, 'running');
  assert.deepEqual(floor.members[1].status, 'inactive');
  assert.deepEqual(floor.taskCounts, { pending: 2, inProgress: 1, completed: 1, blocked: 1, total: 4 });
  assert.deepEqual(value.current, { sessionId: SESSION_ID, isDepartment: true, floorId: SESSION_ID });
  assert.equal(value.degraded.teams, false);
  assert.equal(typeof value.asOf, 'number');
});

test('snapshot route: malformed JSON is the only body-level 400', async () => {
  const host = makeHost();
  registerSnapshotRoute(host.ctx);
  const response = await post(host.connection.routes[0].route, '{not json');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON' });
});

test('snapshot route: a bad envelope is a 400 carrying its reason', async () => {
  const host = makeHost();
  registerSnapshotRoute(host.ctx);
  const response = await post(host.connection.routes[0].route, snapshotEnvelope({ sessionId: 42 }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid office request', reason: 'payload-session-id' });
});

test('snapshot route: a collectOffice escape becomes a 200 domain failure', async () => {
  const host = makeHost({
    services: {
      sessionQuery: {
        listSessions: async () => [
          {
            get header() {
              throw new Error('persistence row exploded');
            },
            live: false,
          },
        ],
      },
    },
  });
  registerSnapshotRoute(host.ctx);
  const response = await post(host.connection.routes[0].route, snapshotEnvelope());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.type, SERVER_RESPONSE);
  assert.equal(body.result.ok, false);
  assert.equal(body.result.error.code, 'office/snapshot-unavailable');
  assert.match(body.result.error.message, /persistence row exploded/);
});

test('snapshot route: no requested session leaves current unset', async () => {
  const host = makeHost();
  registerSnapshotRoute(host.ctx);
  const response = await post(host.connection.routes[0].route, snapshotEnvelope({}));
  const body = await response.json();
  assert.equal(body.result.ok, true);
  assert.deepEqual(body.result.value.current, { sessionId: null, isDepartment: false, floorId: null });
});

// #endregion
// #region command route through the shared ledger

function makeHostWithTeams() {
  const calls = [];
  const host = makeHost({
    services: {
      agentTeams: {
        async createTask(caller, request) {
          calls.push({ method: 'createTask', caller, request });
          return { id: 'task-9', revision: 1, subject: request.subject, status: 'pending', blockedBy: [], writeScopes: [], ready: true };
        },
      },
    },
  });
  return { host, calls };
}

test('command route: a replayed commandId crosses the route without a second write', async () => {
  const { host, calls } = makeHostWithTeams();
  registerOfficeRoutes(host.ctx);
  const route = host.connection.routes.find((entry) => entry.route.path === COMMAND_ROUTE).route;
  const envelope = commandEnvelope(UUID(), 'task.create', { subject: 'ship the office', description: 'host + client' });
  const first = await post(route, envelope);
  const second = await post(route, envelope);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.equal(firstBody.result.ok, true);
  assert.deepEqual(secondBody.result, firstBody.result);
  assert.equal(secondBody.rpcId, envelope.rpcId);
  assert.equal(calls.length, 1, 'the Team service saw the command once');
});

test('command route: a domain rejection stays retryable with the same id', async () => {
  const host = makeHost({
    services: {
      agentTeams: {
        async updateTask() {
          throw Object.assign(new Error('stale revision 1'), { code: 'TEAM_TASK_STALE_REVISION' });
        },
      },
    },
  });
  registerOfficeRoutes(host.ctx);
  const route = host.connection.routes.find((entry) => entry.route.path === COMMAND_ROUTE).route;
  const envelope = commandEnvelope(UUID(), 'task.complete', { taskId: 'task-2', expectedRevision: 1 });
  const first = await post(route, envelope);
  const second = await post(route, envelope);
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.result.ok, false);
  assert.equal(body.result.error.code, 'office/stale-revision');
  assert.equal((await second.json()).result.ok, false, 'a failure is not remembered as a success');
});

test('command route: a malformed envelope is a 400 on the shared route too', async () => {
  const { host, calls } = makeHostWithTeams();
  registerOfficeRoutes(host.ctx);
  const route = host.connection.routes.find((entry) => entry.route.path === COMMAND_ROUTE).route;
  const response = await post(route, { type: CLIENT_REQUEST, rpcId: 'r', method: COMMAND_METHOD, payload: {} });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid command envelope');
  assert.equal(calls.length, 0);
});

// #endregion
