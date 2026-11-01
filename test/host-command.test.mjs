/**
 * Unit tests for the office command channel: envelope and argument validation,
 * commandId idempotency, CAS passthrough, failure mapping and the route itself.
 *
 * No DSH process is involved: the Agent Teams service and the Agent registry are
 * hand-written fakes that record their calls, which is exactly the surface this
 * module is allowed to touch.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommandLedger,
  executeOfficeCommand,
  failFromError,
  readCommandArgs,
  readCommandEnvelope,
  registerCommandRoute,
} from '../src/host/command.js';
import { COMMAND_ROUTE, OFFICE_ERROR } from '../src/shared/contract.js';

const COMMAND_ID = '2f1c3a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const OTHER_COMMAND_ID = '3a2b1c0d-9e8f-4a5b-8c6d-7e8f9a0b1c2d';
const SESSION_ID = 'session-1';

/** Build one client-request envelope for the command route. */
function envelope(action, args, payloadOverrides = {}, envelopeOverrides = {}) {
  return {
    type: 'client-request',
    rpcId: 'rpc-1',
    method: 'cyberOffice/command',
    ...envelopeOverrides,
    payload: {
      commandId: COMMAND_ID,
      sessionId: SESSION_ID,
      action,
      args,
      ...payloadOverrides,
    },
  };
}

/** A Team service double that records every call. */
function fakeTeams(options = {}) {
  const calls = [];
  const teams = {
    calls,
    async createTask(lead, request) {
      calls.push({ method: 'createTask', lead, request });
      if (options.failure !== undefined) throw options.failure;
      return {
        id: 'task-3',
        revision: 1,
        subject: request.subject,
        description: request.description,
        status: 'pending',
        blockedBy: request.blockedBy,
        writeScopes: request.writeScopes,
        ready: true,
        writeScopeWarnings: [],
      };
    },
    async updateTask(lead, request) {
      calls.push({ method: 'updateTask', lead, request });
      if (options.failure !== undefined) throw options.failure;
      return {
        id: request.taskId,
        revision: request.expectedRevision + 1,
        subject: 'subject',
        description: 'description',
        status: request.action === 'complete' ? 'completed' : 'in_progress',
        blockedBy: [],
        writeScopes: [],
        ...(request.owner === undefined ? {} : { ownerName: request.owner }),
        ready: false,
        writeScopeWarnings: [],
      };
    },
    async sendMessage(lead, request) {
      calls.push({ method: 'sendMessage', lead, request });
      if (request.signal === undefined || request.signal === null) throw new TypeError('sendMessage requires an AbortSignal');
      if (options.failure !== undefined) throw options.failure;
      return { messageId: 'message-9' };
    },
    interrupt(lead, target) {
      calls.push({ method: 'interrupt', lead, target });
      if (options.failure !== undefined) throw options.failure;
      return { previousStatus: options.previousStatus ?? 'running' };
    },
  };
  return teams;
}

/** A Cordis context double exposing only the services this module reads. */
function fakeCtx({ teams, agents } = {}) {
  const registry = agents ?? new Map([[SESSION_ID, { id: SESSION_ID, status: 'running' }]]);
  return {
    get(name) {
      if (name === 'agentTeams') return teams;
      if (name === 'agents') return { get: (id) => registry.get(id) };
      return undefined;
    },
  };
}

/** Register the command route against a capturing Connection double. */
function captureRoute(ctx, ledger) {
  let captured;
  const target = {
    ...ctx,
    connection: {
      fetch: {
        register(route) {
          captured = route;
          return () => {};
        },
      },
    },
  };
  registerCommandRoute(target, ledger);
  return captured;
}

/** Build a POST Request for the command route. */
function post(body) {
  return new Request('http://127.0.0.1' + COMMAND_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** One settle-on-demand promise. */
function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Envelope and argument validation
// ---------------------------------------------------------------------------

test('envelope: a complete task.create envelope is accepted and normalized', () => {
  const parsed = readCommandEnvelope(envelope('task.create', { subject: '  Floor plan  ', description: '  draw it  ' }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rpcId, 'rpc-1');
  assert.equal(parsed.payload.commandId, COMMAND_ID);
  assert.equal(parsed.payload.sessionId, SESSION_ID);
  assert.equal(parsed.payload.action, 'task.create');
  assert.deepEqual(parsed.payload.args, { subject: 'Floor plan', description: 'draw it', blockedBy: [], writeScopes: [] });
});

test('envelope: a UUID is lowercased for idempotency', () => {
  const parsed = readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, { commandId: COMMAND_ID.toUpperCase() }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.commandId, COMMAND_ID);
});

test('envelope: non-object bodies are rejected', () => {
  for (const body of [null, 42, 'text', [], undefined]) {
    assert.deepEqual(readCommandEnvelope(body), { ok: false, reason: 'envelope-not-object' });
  }
});

test('envelope: the type discriminator must be client-request', () => {
  assert.deepEqual(readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, {}, { type: 'server-response' })), { ok: false, reason: 'envelope-type' });
  assert.deepEqual(readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, {}, { type: undefined })), { ok: false, reason: 'envelope-type' });
});

test('envelope: rpcId must be a non-empty bounded string', () => {
  assert.deepEqual(readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, {}, { rpcId: '' })), { ok: false, reason: 'envelope-rpc-id' });
  assert.deepEqual(readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, {}, { rpcId: 7 })), { ok: false, reason: 'envelope-rpc-id' });
  assert.deepEqual(readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, {}, { rpcId: 'x'.repeat(300) })), { ok: false, reason: 'envelope-rpc-id' });
});

test('envelope: the method must match the route exactly', () => {
  assert.deepEqual(readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, {}, { method: 'cyberOffice/snapshot' })), { ok: false, reason: 'envelope-method' });
  assert.deepEqual(readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, {}, { method: undefined })), { ok: false, reason: 'envelope-method' });
});

test('envelope: the payload must be a plain object', () => {
  for (const payload of [null, 'text', [1], 3]) {
    assert.deepEqual(readCommandEnvelope({ type: 'client-request', rpcId: 'r', method: 'cyberOffice/command', payload }), { ok: false, reason: 'payload-not-object' });
  }
});

test('envelope: commandId must be a well-formed UUID', () => {
  for (const commandId of [undefined, '', 'not-a-uuid', COMMAND_ID.slice(0, -1), COMMAND_ID + '0', COMMAND_ID.replace('-', '_')]) {
    const parsed = readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, { commandId }));
    assert.deepEqual(parsed, { ok: false, reason: 'payload-command-id' });
  }
});

test('envelope: sessionId must be a non-empty bounded string', () => {
  for (const sessionId of [undefined, '', 5, 'x'.repeat(300)]) {
    const parsed = readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' }, { sessionId }));
    assert.deepEqual(parsed, { ok: false, reason: 'payload-session-id' });
  }
});

test('envelope: an unknown action is rejected', () => {
  assert.deepEqual(readCommandEnvelope(envelope('agent.spawn', { name: 'x' })), { ok: false, reason: 'unknown-action' });
  assert.deepEqual(readCommandEnvelope(envelope(undefined, {})), { ok: false, reason: 'payload-action' });
});

test('args: a non-object argument bag is rejected', () => {
  for (const args of [null, [], 'text', 1]) {
    assert.deepEqual(readCommandArgs('task.create', args), { ok: false, reason: 'args-not-object' });
  }
});

test('args: unknown keys are rejected per action', () => {
  assert.deepEqual(readCommandArgs('agent.interrupt', { target: 'dev', owner: 'x' }), { ok: false, reason: 'unexpected-argument:owner' });
  assert.deepEqual(readCommandArgs('task.complete', { taskId: 'task-1', expectedRevision: 1, description: 'x' }), { ok: false, reason: 'unexpected-argument:description' });
});

test('args: missing required keys are rejected', () => {
  assert.deepEqual(readCommandArgs('task.create', { subject: 's' }), { ok: false, reason: 'missing-argument:description' });
  assert.deepEqual(readCommandArgs('message.send', { target: 'dev' }), { ok: false, reason: 'missing-argument:text' });
});

test('args: task.create validates subject and description bounds', () => {
  assert.deepEqual(readCommandArgs('task.create', { subject: '', description: 'd' }), { ok: false, reason: 'invalid-subject' });
  assert.deepEqual(readCommandArgs('task.create', { subject: '   ', description: 'd' }), { ok: false, reason: 'invalid-subject' });
  assert.deepEqual(readCommandArgs('task.create', { subject: 'x'.repeat(201), description: 'd' }), { ok: false, reason: 'invalid-subject' });
  assert.deepEqual(readCommandArgs('task.create', { subject: 's', description: '   ' }), { ok: false, reason: 'invalid-description' });
  assert.deepEqual(readCommandArgs('task.create', { subject: 's', description: 'x'.repeat(16385) }), { ok: false, reason: 'invalid-description' });
  assert.equal(readCommandArgs('task.create', { subject: 'x'.repeat(200), description: 'x'.repeat(16384) }).ok, true);
});

test('args: blockedBy must be a bounded list of task ids and is de-duplicated', () => {
  assert.deepEqual(readCommandArgs('task.create', { subject: 's', description: 'd', blockedBy: 'task-1' }), { ok: false, reason: 'invalid-blocked-by' });
  assert.deepEqual(readCommandArgs('task.create', { subject: 's', description: 'd', blockedBy: ['1'] }), { ok: false, reason: 'invalid-blocked-by' });
  assert.deepEqual(readCommandArgs('task.create', { subject: 's', description: 'd', blockedBy: Array.from({ length: 65 }, (_, i) => 'task-' + i) }), { ok: false, reason: 'invalid-blocked-by' });
  const ok = readCommandArgs('task.create', { subject: 's', description: 'd', blockedBy: ['task-1', 'task-2', 'task-1'] });
  assert.deepEqual(ok.args.blockedBy, ['task-1', 'task-2']);
});

test('args: writeScopes are normalized, de-duplicated and must stay workspace-relative', () => {
  const normalized = readCommandArgs('task.create', { subject: 's', description: 'd', writeScopes: ['dir\\file', './src/'] });
  assert.deepEqual(normalized.args.writeScopes, ['dir/file', 'src']);
  for (const writeScopes of [['/abs'], ['../up'], ['a/../b'], ['C:/drive'], [''], ['.'], Array.from({ length: 33 }, (_, i) => 's' + i)]) {
    assert.deepEqual(readCommandArgs('task.create', { subject: 's', description: 'd', writeScopes }), { ok: false, reason: 'invalid-write-scopes' });
  }
});

test('args: expectedRevision must be a positive safe integer', () => {
  for (const expectedRevision of [0, -1, 1.5, '3', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(readCommandArgs('task.complete', { taskId: 'task-1', expectedRevision }), { ok: false, reason: 'invalid-expected-revision' });
  }
  assert.equal(readCommandArgs('task.complete', { taskId: 'task-1', expectedRevision: 1 }).ok, true);
});

test('args: taskId must look like task-<n>', () => {
  for (const taskId of ['1', 'task', 'task-x', '', 'x'.repeat(70)]) {
    assert.deepEqual(readCommandArgs('task.reopen', { taskId, expectedRevision: 2 }), { ok: false, reason: 'invalid-task-id' });
  }
});

test('args: assign requires a bounded owner name', () => {
  assert.deepEqual(readCommandArgs('task.assign', { taskId: 'task-1', expectedRevision: 1, owner: '' }), { ok: false, reason: 'invalid-owner' });
  assert.deepEqual(readCommandArgs('task.assign', { taskId: 'task-1', expectedRevision: 1, owner: 'x'.repeat(65) }), { ok: false, reason: 'invalid-owner' });
  assert.deepEqual(readCommandArgs('task.assign', { taskId: 'task-1', expectedRevision: 1, owner: 'dev' }).args, { taskId: 'task-1', expectedRevision: 1, owner: 'dev' });
});

test('args: message.send bounds the target name and the text', () => {
  assert.deepEqual(readCommandArgs('message.send', { target: '', text: 'hi' }), { ok: false, reason: 'invalid-target' });
  assert.deepEqual(readCommandArgs('message.send', { target: 'dev', text: '' }), { ok: false, reason: 'invalid-text' });
  assert.deepEqual(readCommandArgs('message.send', { target: 'dev', text: 'x'.repeat(16385) }), { ok: false, reason: 'invalid-text' });
  assert.deepEqual(readCommandArgs('message.send', { target: 'dev', text: '  hi  ' }).args, { target: 'dev', text: 'hi' });
});

test('args: agent.interrupt requires a bounded target', () => {
  assert.deepEqual(readCommandArgs('agent.interrupt', { target: 'x'.repeat(65) }), { ok: false, reason: 'invalid-target' });
  assert.deepEqual(readCommandArgs('agent.interrupt', { target: 'dev' }).args, { target: 'dev' });
});

// ---------------------------------------------------------------------------
// Idempotency ledger
// ---------------------------------------------------------------------------

test('ledger: successful results replay and refresh LRU order', () => {
  const ledger = new CommandLedger({ capacity: 2, ttlMs: 0 });
  ledger.remember('a', { ok: true, value: 1 });
  ledger.remember('b', { ok: true, value: 2 });
  assert.deepEqual(ledger.replay('a'), { ok: true, value: 1 });
  ledger.remember('c', { ok: true, value: 3 });
  assert.equal(ledger.size, 2);
  assert.deepEqual(ledger.replay('a'), { ok: true, value: 1 });
  assert.equal(ledger.replay('b'), undefined);
  assert.deepEqual(ledger.replay('c'), { ok: true, value: 3 });
});

test('ledger: capacity defaults to 256 entries', () => {
  const ledger = new CommandLedger({ ttlMs: 0 });
  for (let index = 0; index < 300; index += 1) ledger.remember('cmd-' + index, { ok: true, value: index });
  assert.equal(ledger.size, 256);
  assert.equal(ledger.replay('cmd-0'), undefined);
  assert.deepEqual(ledger.replay('cmd-299'), { ok: true, value: 299 });
});

test('ledger: entries expire after the replay TTL', () => {
  let now = 1000;
  const ledger = new CommandLedger({ ttlMs: 5000, now: () => now });
  ledger.remember('a', { ok: true });
  now = 5999;
  assert.deepEqual(ledger.replay('a'), { ok: true });
  now = 6000;
  assert.equal(ledger.replay('a'), undefined);
  assert.equal(ledger.size, 0);
});

test('ledger: the in-flight set tracks one command at a time', () => {
  const ledger = new CommandLedger({ ttlMs: 0 });
  assert.equal(ledger.isInflight('a'), false);
  ledger.begin('a');
  assert.equal(ledger.isInflight('a'), true);
  ledger.finish('a');
  assert.equal(ledger.isInflight('a'), false);
  ledger.remember('a', { ok: true });
  ledger.clear();
  assert.equal(ledger.size, 0);
  assert.equal(ledger.replay('a'), undefined);
});

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

test('execute: task.create calls createTask with the Lead and normalized arguments', async () => {
  const teams = fakeTeams();
  const ctx = fakeCtx({ teams });
  const payload = readCommandEnvelope(envelope('task.create', { subject: 'Task A', description: 'Do A', blockedBy: ['task-1'], writeScopes: ['src/host'] })).payload;
  const result = await executeOfficeCommand(ctx, payload);
  assert.equal(result.ok, true);
  assert.equal(result.value.action, 'task.create');
  assert.equal(result.value.commandId, COMMAND_ID);
  assert.equal(result.value.sessionId, SESSION_ID);
  assert.deepEqual(result.value.task, { id: 'task-3', revision: 1, subject: 'Task A', status: 'pending', ownerName: null, ready: true });
  assert.equal(teams.calls.length, 1);
  assert.equal(teams.calls[0].method, 'createTask');
  assert.equal(teams.calls[0].lead.id, SESSION_ID);
  assert.deepEqual(teams.calls[0].request, { subject: 'Task A', description: 'Do A', blockedBy: ['task-1'], writeScopes: ['src/host'] });
});

test('execute: task.assign is a Lead reassign with the snapshot revision', async () => {
  const teams = fakeTeams();
  const ctx = fakeCtx({ teams });
  const payload = readCommandEnvelope(envelope('task.assign', { taskId: 'task-4', expectedRevision: 2, owner: 'dev' })).payload;
  const result = await executeOfficeCommand(ctx, payload);
  assert.equal(result.ok, true);
  assert.deepEqual(teams.calls[0].request, { taskId: 'task-4', expectedRevision: 2, action: 'reassign', owner: 'dev' });
  assert.equal(result.value.task.ownerName, 'dev');
});

test('execute: task.complete and task.reopen keep their CAS revision', async () => {
  const teams = fakeTeams();
  const ctx = fakeCtx({ teams });
  await executeOfficeCommand(ctx, readCommandEnvelope(envelope('task.complete', { taskId: 'task-5', expectedRevision: 3 })).payload);
  await executeOfficeCommand(ctx, readCommandEnvelope(envelope('task.reopen', { taskId: 'task-5', expectedRevision: 4 })).payload);
  assert.deepEqual(teams.calls.map((call) => call.request.action), ['complete', 'reopen']);
  assert.deepEqual(teams.calls.map((call) => call.request.expectedRevision), [3, 4]);
});

test('execute: message.send forwards a text block and a cancellation signal', async () => {
  const teams = fakeTeams();
  const ctx = fakeCtx({ teams });
  const payload = readCommandEnvelope(envelope('message.send', { target: 'dev', text: 'hello there' })).payload;
  const result = await executeOfficeCommand(ctx, payload, { signal: new AbortController().signal, timeoutMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.value.messageId, 'message-9');
  const request = teams.calls[0].request;
  assert.equal(request.target, 'dev');
  assert.deepEqual(request.content, [{ type: 'text', text: 'hello there' }]);
  assert.equal(typeof request.signal.aborted, 'boolean');
});

test('execute: message.send still supplies a signal without a caller one', async () => {
  const teams = fakeTeams();
  const ctx = fakeCtx({ teams });
  const result = await executeOfficeCommand(ctx, readCommandEnvelope(envelope('message.send', { target: 'dev', text: 'hi' })).payload);
  assert.equal(result.ok, true);
  assert.equal(typeof teams.calls[0].request.signal.aborted, 'boolean');
});

test('execute: agent.interrupt reports the pre-cancel status', async () => {
  const teams = fakeTeams({ previousStatus: 'inactive' });
  const ctx = fakeCtx({ teams });
  const result = await executeOfficeCommand(ctx, readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' })).payload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { action: 'agent.interrupt', commandId: COMMAND_ID, sessionId: SESSION_ID, target: 'dev', previousStatus: 'inactive' });
});

test('execute: a missing Agent Teams service fails closed', async () => {
  const ctx = fakeCtx({ teams: undefined });
  const result = await executeOfficeCommand(ctx, readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' })).payload);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OFFICE_ERROR.teamUnavailable);
});

test('execute: a session without a live Agent fails closed', async () => {
  const teams = fakeTeams();
  const ctx = fakeCtx({ teams, agents: new Map() });
  const result = await executeOfficeCommand(ctx, readCommandEnvelope(envelope('agent.interrupt', { target: 'dev' })).payload);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OFFICE_ERROR.sessionNotLive);
  assert.equal(teams.calls.length, 0);
});

test('execute: a stale revision maps to office/stale-revision', async () => {
  const failure = Object.assign(new Error('stale revision'), { code: 'TEAM_TASK_STALE_REVISION' });
  const teams = fakeTeams({ failure });
  const ctx = fakeCtx({ teams });
  const result = await executeOfficeCommand(ctx, readCommandEnvelope(envelope('task.complete', { taskId: 'task-1', expectedRevision: 1 })).payload);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OFFICE_ERROR.staleRevision);
  assert.deepEqual(result.error.details, { teamCode: 'TEAM_TASK_STALE_REVISION' });
});

test('execute: a non-Lead caller maps to office/lead-required', async () => {
  const failure = Object.assign(new Error('lead only'), { code: 'TEAM_LEAD_REQUIRED' });
  const teams = fakeTeams({ failure });
  const ctx = fakeCtx({ teams });
  const result = await executeOfficeCommand(ctx, readCommandEnvelope(envelope('task.assign', { taskId: 'task-1', expectedRevision: 1, owner: 'dev' })).payload);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OFFICE_ERROR.leadRequired);
});

test('execute: an unrecognized Team code stays closed but keeps the original', () => {
  const result = failFromError(Object.assign(new Error('odd'), { code: 'TEAM_FUTURE_CODE' }), 'task.complete');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OFFICE_ERROR.internal);
  assert.deepEqual(result.error.details, { teamCode: 'TEAM_FUTURE_CODE' });
});

test('execute: an aborted message send reports unknown delivery', () => {
  const result = failFromError(Object.assign(new Error('aborted'), { name: 'AbortError' }), 'message.send');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OFFICE_ERROR.timeout);
  assert.deepEqual(result.error.details, { deliveryUnknown: true });
});

test('execute: an aborted task action reports unknown delivery', () => {
  const result = failFromError(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }), 'task.complete');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OFFICE_ERROR.timeout);
  assert.deepEqual(result.error.details, { deliveryUnknown: true });
});

test('execute: a plain error maps to office/internal', () => {
  const result = failFromError(new Error('unexpected'), 'task.create');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, OFFICE_ERROR.internal);
  assert.equal(result.error.message, 'unexpected');
  assert.deepEqual(result.error.details, {});
});

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

test('route: registers the contracted path, method and buffered body', () => {
  const teams = fakeTeams();
  const route = captureRoute(fakeCtx({ teams }));
  assert.equal(route.path, COMMAND_ROUTE);
  assert.equal(route.path, '/api/cyberOffice/command');
  assert.deepEqual(route.methods, ['POST']);
  assert.equal(route.requestBody, 'buffered');
  assert.equal(typeof route.fetch, 'function');
});

test('route: malformed JSON is the only 400 for a body', async () => {
  const route = captureRoute(fakeCtx({ teams: fakeTeams() }));
  const response = await route.fetch(post('{not json'));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON' });
});

test('route: a bad envelope is a 400 with its reason', async () => {
  const route = captureRoute(fakeCtx({ teams: fakeTeams() }));
  const response = await route.fetch(post(envelope('task.create', { subject: 's' })));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'Invalid command envelope');
  assert.equal(body.reason, 'missing-argument:description');
});

test('route: a success is a server-response with no-store caching', async () => {
  const teams = fakeTeams();
  const route = captureRoute(fakeCtx({ teams }));
  const response = await route.fetch(post(envelope('agent.interrupt', { target: 'dev' })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.type, 'server-response');
  assert.equal(body.rpcId, 'rpc-1');
  assert.equal(body.result.ok, true);
  assert.equal(body.result.value.action, 'agent.interrupt');
});

test('route: a repeated commandId replays without a second service call', async () => {
  const teams = fakeTeams();
  const route = captureRoute(fakeCtx({ teams }));
  const request = envelope('task.create', { subject: 'Once', description: 'only once' });
  const first = await (await route.fetch(post(request))).json();
  const second = await (await route.fetch(post(request))).json();
  assert.equal(teams.calls.length, 1);
  assert.deepEqual(second, first);
});

test('route: a domain failure is a 200 with ok:false and is retryable', async () => {
  let attempts = 0;
  const teams = fakeTeams();
  const create = teams.createTask;
  teams.createTask = async (lead, request) => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('task limit reached'), { code: 'TEAM_TASK_LIMIT' });
    return await create(lead, request);
  };
  const route = captureRoute(fakeCtx({ teams }));
  const request = envelope('task.create', { subject: 'Retry', description: 'retry me' });
  const first = await route.fetch(post(request));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.result.ok, false);
  assert.equal(firstBody.result.error.code, OFFICE_ERROR.taskLimit);
  const secondBody = await (await route.fetch(post(request))).json();
  assert.equal(secondBody.result.ok, true);
  assert.equal(attempts, 2);
});

test('route: a concurrent duplicate commandId reports busy', async () => {
  const gate = deferred();
  const teams = fakeTeams();
  teams.createTask = async () => {
    await gate.promise;
    return { id: 'task-1', revision: 1, subject: 's', description: 'd', status: 'pending', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [] };
  };
  const route = captureRoute(fakeCtx({ teams }));
  const request = envelope('task.create', { subject: 'Slow', description: 'slow' });
  const first = route.fetch(post(request));
  await new Promise((settle) => setImmediate(settle));
  const second = await (await route.fetch(post(request))).json();
  assert.equal(second.result.ok, false);
  assert.equal(second.result.error.code, OFFICE_ERROR.busy);
  gate.resolve();
  const firstBody = await (await first).json();
  assert.equal(firstBody.result.ok, true);
});

test('route: the same command id may be reused with a different payload after success', async () => {
  const teams = fakeTeams();
  const route = captureRoute(fakeCtx({ teams }));
  await route.fetch(post(envelope('agent.interrupt', { target: 'dev' })));
  const replay = await (await route.fetch(post(envelope('agent.interrupt', { target: 'other' }, { commandId: OTHER_COMMAND_ID })))).json();
  assert.equal(replay.result.ok, true);
  assert.equal(teams.calls.length, 2);
});

test('route: an unavailable Team service answers 200 with a stable code', async () => {
  const route = captureRoute(fakeCtx({ teams: undefined }));
  const response = await route.fetch(post(envelope('agent.interrupt', { target: 'dev' })));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.ok, false);
  assert.equal(body.result.error.code, OFFICE_ERROR.teamUnavailable);
});
