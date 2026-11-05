import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { executeOfficeCommand, registerCommandRoute, CommandLedger } from '../src/host/command.js';
import { useOfficeCommands } from '../src/client/commands/use-commands.js';
import { createCommandController, executeCommandIntent } from '../src/client/commands/controller.js';
import { deriveSeatFacts } from '../src/client/model/state.js';

const commandId = '4a7b9a89-7358-41ce-8de4-783f2548feea';
const task = { id: 'task-1', subject: 'Do real work', revision: 3, status: 'in_progress', ownerName: 'lead', blockedBy: [] };
function fixture(owner = 'lead') {
  let current = { ...task, ownerName: owner }, live;
  const calls = [];
  const lead = { id: 'root', status: 'idle', steer(message) { calls.push(['steer', message]); } };
  live = lead;
  const teams = {
    membership(actor) { assert.equal(actor, lead); return { root: lead, role: 'lead', name: 'lead' }; },
    getTask(actor, id) { assert.equal(actor, lead); return id === current.id ? { ...current } : null; },
    async createTask(actor, args) { assert.equal(actor, lead); calls.push(['create']); current = { ...current, ...args, status: 'pending', ownerName: null, revision: 1 }; return { ...current }; },
    async updateTask(actor, args) { assert.equal(actor, lead); assert.equal(args.expectedRevision, current.revision); calls.push(['assign']); current = { ...current, status: 'in_progress', ownerName: args.owner, revision: current.revision + 1 }; return { ...current }; },
    async sendMessage(actor, request) { assert.equal(actor, lead); calls.push(['sendMessage', request]); return { messageId: 'accepted-member-message' }; },
  };
  const ctx = { get: name => name === 'agentTeams' ? teams : name === 'agents' ? { get: () => live } : undefined };
  return { ctx, teams, lead, calls, replace: value => { live = value; } };
}
const start = () => ({ commandId, sessionId: 'root', action: 'task.start', args: { taskId: task.id, expectedRevision: task.revision } });

test('lead execution uses the exact root waking API with an identified immutable, honestly attributed UserMessage', async () => {
  const h = fixture();
  const result = await executeOfficeCommand(h.ctx, start());
  assert.equal(result.ok, true); assert.equal(result.value.execution, 'accepted');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], 'steer');
  const message = h.calls[0][1];
  assert.match(message.id, /^[0-9a-f-]{36}$/); assert.equal(result.value.messageId, message.id);
  assert.equal(message.role, 'user'); assert.match(message.content[0].text, /task-1/);
  assert.deepEqual(message.source, { kind: 'dsh-cyber-dept', commandId, taskId: task.id });
  for (const value of [message, message.content, message.content[0], message.source]) assert.equal(Object.isFrozen(value), true);
  assert.equal(h.lead.status, 'idle', 'the plugin must not fabricate an active model state from an accepted instruction');
});

test('lead execution fails closed for absent APIs, wrong root identities and changed live sessions', async () => {
  for (const change of [h => { delete h.lead.steer; }, h => { delete h.teams.membership; }]) {
    const h = fixture(); change(h); const result = await executeOfficeCommand(h.ctx, start());
    assert.equal(result.error.code, 'office/execution-unavailable'); assert.deepEqual(h.calls, []);
  }
  const h = fixture(); h.teams.membership = () => ({ root: { id: 'root' }, role: 'lead' });
  assert.equal((await executeOfficeCommand(h.ctx, start())).error.code, 'office/lead-required'); assert.deepEqual(h.calls, []);
  const changed = fixture(); const read = changed.teams.getTask;
  changed.teams.getTask = (...args) => { changed.replace({ id: 'root' }); return read(...args); };
  assert.equal((await executeOfficeCommand(changed.ctx, start())).error.code, 'office/session-not-live'); assert.deepEqual(changed.calls, []);
});

test('member execution keeps the official cold-recovery/message route and rejects missing acceptance receipts', async () => {
  const h = fixture('worker');
  const accepted = await executeOfficeCommand(h.ctx, start());
  assert.equal(accepted.ok, true); assert.equal(accepted.value.execution, 'accepted');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], 'sendMessage');
  assert.equal(h.calls[0][1].target, 'worker'); assert.ok(h.calls[0][1].signal instanceof AbortSignal);
  const missing = fixture('worker'); missing.teams.sendMessage = async () => ({});
  const unknown = await executeOfficeCommand(missing.ctx, start());
  assert.equal(unknown.ok, false); assert.equal(unknown.error.details.deliveryUnknown, true);
  const unsupported = fixture('worker'); delete unsupported.teams.sendMessage;
  assert.equal((await executeOfficeCommand(unsupported.ctx, start())).error.code, 'office/execution-unavailable');
});

test('a Lead driver failure after the dispatch boundary remains uncertain and is never retried', async () => {
  const h = fixture();
  h.lead.steer = message => { h.calls.push(['steer', message]); throw new Error('persistence failed during dispatch'); };
  const result = await executeOfficeCommand(h.ctx, start());
  assert.equal(result.ok, false); assert.equal(result.error.details.deliveryUnknown, true);
  assert.equal(result.error.details.messageId, h.calls[0][1].id); assert.equal(h.calls.length, 1);
});

test('a repeated lead command ID replays its receipt without steering again', async () => {
  const h = fixture(); let route;
  registerCommandRoute({ ...h.ctx, connection: { fetch: { register: value => { route = value; } } } }, new CommandLedger());
  const request = () => new Request('http://mock/api/cyberOffice/command', { method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'rpc', method: 'cyberOffice/command', payload: start() }) });
  const first = await (await route.fetch(request())).json(), second = await (await route.fetch(request())).json();
  assert.equal(first.result.ok, true); assert.deepEqual(second.result, first.result); assert.equal(h.calls.length, 1);
});

test('default assignment confirmation reaches a waking host API for both a member and the lead', async () => {
  for (const name of ['worker', 'lead']) {
    const h = fixture(name), seat = { id: name === 'lead' ? 'root' : 'worker-session', name, role: name === 'lead' ? 'lead' : 'teammate', phase: 'active', state: 'idle' };
    const controller = createCommandController({ execute: draft => executeCommandIntent(draft, (_session, action, args) => executeOfficeCommand(h.ctx, { commandId, sessionId: 'root', action, args })) });
    let state, renderer;
    function Hook() { state = useOfficeCommands({ seat, floor: { id: 'root' }, writeGate: { enabled: true }, commandController: controller }); return null; }
    act(() => { renderer = TestRenderer.create(React.createElement(Hook)); });
    act(() => state.openAssign()); assert.equal(state.write.executeNow, true); assert.equal(state.write.executeAllowed, true);
    act(() => state.patchWrite({ subject: 'Implement', description: 'Acceptance criteria' }));
    await act(async () => { await state.runWrite(state.write); });
    assert.equal(state.write.phase, 'done');
    assert.deepEqual(h.calls.map(call => call[0]), ['create', 'assign', name === 'lead' ? 'steer' : 'sendMessage']);
    assert.equal(state.write.value.execution, 'accepted');
    act(() => renderer.unmount());
  }
});

test('explicit assign-only commits the board but neither dispatches nor implies model activity', async () => {
  const h = fixture();
  const result = await executeCommandIntent({ kind: 'assign', floorId: 'root', seatName: 'lead', subject: 'Later', description: 'Only plan', executeNow: false }, (_id, action, args) => executeOfficeCommand(h.ctx, { commandId, sessionId: 'root', action, args }));
  assert.equal(result.phase, 'done'); assert.deepEqual(h.calls.map(call => call[0]), ['create', 'assign']);
  const facts = deriveSeatFacts({ live: true, member: { state: 'idle' }, task: { status: 'in_progress' } });
  assert.equal(facts.activity, 'idle'); assert.equal(facts.displayState, 'idle');
});


test('a member failure after inbox acceptance is uncertain and a repeated command ID never sends again', async () => {
  const h = fixture('worker'); let route;
  h.teams.sendMessage = async (_lead, request) => {
    h.calls.push(['sendMessage', request]);
    throw new Error('persistence or activity notification failed after acceptance');
  };
  registerCommandRoute({ ...h.ctx, connection: { fetch: { register: value => { route = value; } } } }, new CommandLedger());
  const request = () => new Request('http://mock/api/cyberOffice/command', { method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'rpc', method: 'cyberOffice/command', payload: start() }) });
  const first = await (await route.fetch(request())).json(), second = await (await route.fetch(request())).json();
  assert.equal(first.result.ok, false);
  assert.equal(first.result.error.code, 'office/internal');
  assert.equal(first.result.error.details.deliveryUnknown, true);
  assert.deepEqual(second.result, first.result);
  assert.equal(h.calls.length, 1);
});
