/**
 * Unit tests for the cyberAgent fold.
 *
 * The fold is the only part of the plugin the client renders from directly, so
 * these tests pin three things: the phase machine, the "same reference for
 * unrelated events" rule the projection registry depends on, and the wire view's
 * exact field set.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCyberAgent,
  createCyberAgentState,
  cyberAgentProjectionDefinition,
  cyberAgentView,
  passthroughSchema,
} from '../src/host/projection.js';
import { CYBER_PHASE, PROJECTION_KEY, PROJECTION_STATE_VERSION } from '../src/shared/contract.js';

/** One committed session event. */
function ev(type, data, seq = 0, time = 1000) {
  return { type, data, seq, time };
}

/** Fold a list of events from a fresh state. */
function fold(events, header = { createdAt: 5 }) {
  return events.reduce((state, event) => applyCyberAgent(state, event), createCyberAgentState(header));
}

test('definition: key, state version and schemas match the contract', () => {
  assert.equal(cyberAgentProjectionDefinition.key, PROJECTION_KEY);
  assert.equal(cyberAgentProjectionDefinition.key, 'cyberAgent');
  assert.equal(cyberAgentProjectionDefinition.stateVersion, PROJECTION_STATE_VERSION);
  assert.equal(cyberAgentProjectionDefinition.stateVersion, 1);
  assert.equal(cyberAgentProjectionDefinition.stateSchema, passthroughSchema);
  assert.equal(cyberAgentProjectionDefinition.wire.viewSchema, passthroughSchema);
  assert.equal(cyberAgentProjectionDefinition.wire.view, cyberAgentView);
  assert.equal(typeof cyberAgentProjectionDefinition.apply, 'function');
  assert.equal(typeof cyberAgentProjectionDefinition.init, 'function');
});

test('passthroughSchema: parse and safeParse are identity', () => {
  const value = { any: ['shape'] };
  assert.equal(passthroughSchema.parse(value), value);
  assert.deepEqual(passthroughSchema.safeParse(value), { success: true, data: value });
});

test('init: idle defaults, since taken from the session header', () => {
  const state = createCyberAgentState({ createdAt: 1234 });
  assert.deepEqual(state, {
    phase: CYBER_PHASE.idle,
    since: 1234,
    turn: null,
    tool: null,
    approval: null,
    error: null,
    seq: -1,
  });
});

test('init: a missing or malformed header leaves since null', () => {
  assert.equal(createCyberAgentState(undefined).since, null);
  assert.equal(createCyberAgentState(null).since, null);
  assert.equal(createCyberAgentState({ createdAt: 'yesterday' }).since, null);
});

test('unrelated events keep the same state reference', () => {
  const state = createCyberAgentState({ createdAt: 1 });
  for (const type of ['user/message', 'assistant/message', 'step/start', 'step/end', 'todo/write', 'job/registered']) {
    assert.equal(applyCyberAgent(state, ev(type, { anything: true }, 4, 10)), state);
  }
});

test('unrelated events do not move the watermark', () => {
  const state = fold([ev('turn/start', { turn: 1 }, 0, 10)]);
  const untouched = applyCyberAgent(state, ev('user/message', {}, 9, 20));
  assert.equal(untouched, state);
  assert.equal(untouched.seq, 0);
});

test('non-object inputs are ignored rather than thrown on', () => {
  const state = createCyberAgentState({ createdAt: 1 });
  assert.equal(applyCyberAgent(state, null), state);
  assert.equal(applyCyberAgent(null, ev('turn/start', { turn: 1 })), null);
});

test('turn/start: running phase with turn, since and watermark', () => {
  const state = fold([ev('turn/start', { turn: 7 }, 3, 111)]);
  assert.equal(state.phase, CYBER_PHASE.running);
  assert.equal(state.turn, 7);
  assert.equal(state.since, 111);
  assert.equal(state.seq, 3);
});

test('turn/start clears a previous error, tool and approval', () => {
  const errored = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('tool/call', { name: 'bash', callId: 'c1' }, 1, 11),
    ev('approval/asked', { id: 'a1', toolName: 'bash' }, 2, 12),
    ev('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'boom' } } }, 3, 13),
  ]);
  assert.equal(errored.phase, CYBER_PHASE.error);
  const restarted = applyCyberAgent(errored, ev('turn/start', { turn: 2 }, 4, 14));
  assert.equal(restarted.phase, CYBER_PHASE.running);
  assert.equal(restarted.error, null);
  assert.equal(restarted.tool, null);
  assert.equal(restarted.approval, null);
});

test('tool/call: enters the tool phase with name and callId', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('tool/call', { turn: 1, step: 1, callId: 'call-9', name: 'pwsh' }, 1, 20),
  ]);
  assert.equal(state.phase, CYBER_PHASE.tool);
  assert.deepEqual(state.tool, { name: 'pwsh', callId: 'call-9' });
  assert.equal(state.since, 20);
});

test('tool/call: an over-long tool name is truncated', () => {
  const state = applyCyberAgent(
    createCyberAgentState({ createdAt: 1 }),
    ev('tool/call', { callId: 'c', name: 'x'.repeat(400) }, 0, 10),
  );
  assert.equal(state.tool.name.length, 80);
});

test('tool/call: a missing name or callId degrades to null fields', () => {
  const state = applyCyberAgent(createCyberAgentState({ createdAt: 1 }), ev('tool/call', {}, 0, 10));
  assert.equal(state.phase, CYBER_PHASE.tool);
  assert.deepEqual(state.tool, { name: null, callId: null });
});

test('tool/result: matching callId returns to running and clears the tool', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('tool/call', { callId: 'call-1', name: 'bash' }, 1, 20),
    ev('tool/result', { turn: 1, step: 1, message: { source: { callId: 'call-1' } } }, 2, 30),
  ]);
  assert.equal(state.phase, CYBER_PHASE.running);
  assert.equal(state.tool, null);
  assert.equal(state.since, 30);
});

test('tool/result: a mismatched callId keeps the open tool', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('tool/call', { callId: 'call-1', name: 'bash' }, 1, 20),
  ]);
  const stale = applyCyberAgent(state, ev('tool/result', { message: { source: { callId: 'call-OLD' } } }, 2, 30));
  assert.equal(stale, state);
});

test('tool/result with no open tool is a no-op', () => {
  const state = fold([ev('turn/start', { turn: 1 }, 0, 10)]);
  assert.equal(applyCyberAgent(state, ev('tool/result', { message: { source: { callId: 'c' } } }, 1, 20)), state);
});

test('tool/result tolerates a missing message payload', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('tool/call', { callId: 'call-1', name: 'bash' }, 1, 20),
  ]);
  const next = applyCyberAgent(state, ev('tool/result', {}, 2, 30));
  assert.equal(next.phase, CYBER_PHASE.running);
  assert.equal(next.tool, null);
});

test('approval/asked: waiting-approval carries id, tool name and reason', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('approval/asked', { id: 'ap-1', toolName: 'pwsh', callId: 'c1', reason: 'runs a command' }, 1, 40),
  ]);
  assert.equal(state.phase, CYBER_PHASE.waitingApproval);
  assert.deepEqual(state.approval, { id: 'ap-1', toolName: 'pwsh', reason: 'runs a command' });
});

test('approval/asked: a missing reason is reported as null', () => {
  const state = applyCyberAgent(createCyberAgentState({ createdAt: 1 }), ev('approval/asked', { id: 'ap-1', toolName: 'pwsh' }, 0, 10));
  assert.equal(state.approval.reason, null);
});

test('approval/decided: matching id clears the pending approval', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('approval/asked', { id: 'ap-1', toolName: 'pwsh' }, 1, 20),
    ev('approval/decided', { id: 'ap-1', outcome: 'allowed-once' }, 2, 30),
  ]);
  assert.equal(state.phase, CYBER_PHASE.running);
  assert.equal(state.approval, null);
  assert.equal(state.since, 30);
});

test('approval/decided: a mismatched id keeps the pending approval', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('approval/asked', { id: 'ap-1', toolName: 'pwsh' }, 1, 20),
  ]);
  assert.equal(applyCyberAgent(state, ev('approval/decided', { id: 'ap-OTHER' }, 2, 30)), state);
});

test('approval/decided with nothing pending is a no-op', () => {
  const state = fold([ev('turn/start', { turn: 1 }, 0, 10)]);
  assert.equal(applyCyberAgent(state, ev('approval/decided', { id: 'ap-1' }, 1, 20)), state);
});

test('turn/end completed: done phase, no error', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 1, 30),
  ]);
  assert.equal(state.phase, CYBER_PHASE.done);
  assert.equal(state.turn, 1);
  assert.equal(state.error, null);
  assert.equal(state.seq, 1);
});

test('turn/end error: error phase with the provider message', () => {
  const state = fold([
    ev('turn/start', { turn: 2 }, 0, 10),
    ev('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'adaptor exploded', code: 'E' } } }, 1, 30),
  ]);
  assert.equal(state.phase, CYBER_PHASE.error);
  assert.equal(state.error, 'adaptor exploded');
});

test('turn/end error: a string error value is used verbatim', () => {
  const state = fold([ev('turn/end', { turn: 1, reason: { kind: 'error', error: 'plain failure' } }, 0, 30)]);
  assert.equal(state.error, 'plain failure');
});

test('turn/end error: no message still yields a non-empty error', () => {
  const state = fold([ev('turn/end', { turn: 1, reason: { kind: 'error' } }, 0, 30)]);
  assert.equal(state.phase, CYBER_PHASE.error);
  assert.equal(state.error, 'turn failed');
});

test('turn/end blocked: blocked phase without an error', () => {
  const state = fold([ev('turn/end', { turn: 1, reason: { kind: 'blocked' } }, 0, 30)]);
  assert.equal(state.phase, CYBER_PHASE.blocked);
  assert.equal(state.error, null);
});

test('turn/end aborted: idle phase (interrupted is not an error)', () => {
  const state = fold([ev('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }, 0, 30)]);
  assert.equal(state.phase, CYBER_PHASE.idle);
  assert.equal(state.error, null);
});

test('turn/end with an unknown reason kind settles as done', () => {
  const state = fold([ev('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }, 0, 30)]);
  assert.equal(state.phase, CYBER_PHASE.done);
});

test('turn/end clears tool and approval leftovers', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('tool/call', { callId: 'c', name: 'bash' }, 1, 11),
    ev('approval/asked', { id: 'a', toolName: 'bash' }, 2, 12),
    ev('turn/end', { turn: 1, reason: { kind: 'aborted' } }, 3, 13),
  ]);
  assert.equal(state.tool, null);
  assert.equal(state.approval, null);
});

test('turn/end without data does not throw and keeps a closed phase', () => {
  const state = fold([ev('turn/end', undefined, 0, 30)]);
  assert.equal(state.phase, CYBER_PHASE.done);
});

test('full lifecycle folds into one truthful state', () => {
  const state = fold([
    ev('user/message', {}, 0, 1),
    ev('turn/start', { turn: 1 }, 1, 10),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash' }, 2, 20),
    ev('tool/result', { turn: 1, step: 1, message: { source: { callId: 'c1' } } }, 3, 25),
    ev('approval/asked', { id: 'a1', toolName: 'pwsh' }, 4, 30),
    ev('approval/decided', { id: 'a1', outcome: 'rejected' }, 5, 31),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }, 6, 40),
  ]);
  assert.equal(state.phase, CYBER_PHASE.done);
  assert.equal(state.turn, 1);
  assert.equal(state.tool, null);
  assert.equal(state.approval, null);
  assert.equal(state.error, null);
  assert.equal(state.seq, 6);
  assert.equal(state.since, 40);
});

test('wire view exposes exactly the UI fields', () => {
  const state = fold([
    ev('turn/start', { turn: 3 }, 0, 10),
    ev('tool/call', { callId: 'c1', name: 'bash' }, 1, 20),
  ]);
  const view = cyberAgentView(state);
  assert.deepEqual(Object.keys(view).sort(), ['approval', 'error', 'phase', 'since', 'tool', 'turn']);
  assert.equal('seq' in view, false);
  assert.deepEqual(view.tool, { name: 'bash', callId: 'c1' });
  assert.equal(view.phase, CYBER_PHASE.tool);
  assert.equal(view.turn, 3);
});

test('wire view is reference-stable per state', () => {
  const state = createCyberAgentState({ createdAt: 1 });
  assert.equal(cyberAgentView(state), cyberAgentView(state));
});

test('wire view copies tool and approval objects', () => {
  const state = fold([
    ev('approval/asked', { id: 'a1', toolName: 'bash' }, 0, 10),
    ev('tool/call', { callId: 'c1', name: 'bash' }, 1, 20),
  ]);
  const view = cyberAgentView(state);
  assert.notEqual(view.tool, state.tool);
  assert.notEqual(view.approval, state.approval);
  assert.equal(Object.isFrozen(view), true);
});

test('wire view normalizes absent pieces to null', () => {
  const view = cyberAgentView(createCyberAgentState({ createdAt: null }));
  assert.deepEqual(view, {
    phase: CYBER_PHASE.idle,
    since: null,
    turn: null,
    tool: null,
    approval: null,
    error: null,
  });
});

test('the fold state is safe to checkpoint (structured clone)', () => {
  const state = fold([
    ev('turn/start', { turn: 1 }, 0, 10),
    ev('tool/call', { callId: 'c1', name: 'bash' }, 1, 20),
    ev('approval/asked', { id: 'a1', toolName: 'pwsh', reason: 'why not' }, 2, 30),
  ]);
  assert.deepEqual(structuredClone(state), state);
  assert.deepEqual(cyberAgentProjectionDefinition.stateSchema.parse(structuredClone(state)), state);
});

test('the fold is synchronous: no event ever returns a promise', () => {
  const state = createCyberAgentState({ createdAt: 1 });
  const events = [
    ev('turn/start', { turn: 1 }),
    ev('tool/call', { callId: 'c', name: 'bash' }),
    ev('tool/result', { message: { source: { callId: 'c' } } }),
    ev('approval/asked', { id: 'a', toolName: 'pwsh' }),
    ev('approval/decided', { id: 'a', outcome: 'allowed-once' }),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ev('user/message', {}),
  ];
  for (const event of events) {
    const next = applyCyberAgent(state, event);
    assert.equal(typeof next?.then, 'undefined');
  }
});

test('the definition wire view runs end to end through its schema', () => {
  const state = fold([ev('turn/start', { turn: 4 }, 0, 10), ev('tool/call', { callId: 'c1', name: 'bash' }, 1, 20)]);
  const raw = cyberAgentProjectionDefinition.wire.view(state);
  const parsed = cyberAgentProjectionDefinition.wire.viewSchema.parse(raw);
  assert.equal(parsed, raw);
  assert.deepEqual(parsed, cyberAgentView(state));
});

test('wire view survives a hand-edited state with wrong field types', () => {
  const view = cyberAgentView({ phase: 'tool', since: 'soon', turn: -3, tool: 'bash', approval: 7, error: 9, seq: 1 });
  assert.equal(view.since, null);
  assert.equal(view.turn, null);
  assert.equal(view.tool, null);
  assert.equal(view.approval, null);
  assert.equal(view.error, null);
});
