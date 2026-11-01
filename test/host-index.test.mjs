/**
 * Wiring test for the plugin entry: the host half must register exactly one
 * projection unit and both office routes on the calling fiber, and the composite
 * disposer must release them in one step.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, cyberAgentProjectionDefinition, inject, name } from '../index.js';
import { registerOfficeRoutes } from '../src/host/route.js';
import { COMMAND_ROUTE, PROJECTION_KEY, SNAPSHOT_ROUTE } from '../src/shared/contract.js';

/** A Context double that records every registration. */
function makeCtx() {
  const state = { projections: [], routes: [], disposed: [] };
  const ctx = {
    sessionProjections: {
      register(definition) {
        state.projections.push(definition);
        return () => state.disposed.push('projection');
      },
    },
    connection: {
      fetch: {
        register(route) {
          state.routes.push(route);
          return () => state.disposed.push(route.path);
        },
      },
    },
    get() {
      return undefined;
    },
  };
  return { ctx, state };
}

test('plugin identity and required services', () => {
  assert.equal(name, 'dsh-cyber-dept');
  assert.deepEqual(inject, ['connection', 'sessionProjections', 'sessionQuery', 'agents']);
});

test('apply registers the cyberAgent unit and both routes', () => {
  const { ctx, state } = makeCtx();
  apply(ctx);
  assert.equal(state.projections.length, 1);
  assert.equal(state.projections[0], cyberAgentProjectionDefinition);
  assert.equal(state.projections[0].key, PROJECTION_KEY);
  assert.deepEqual(state.routes.map((route) => route.path).sort(), [COMMAND_ROUTE, SNAPSHOT_ROUTE]);
  for (const route of state.routes) {
    assert.deepEqual(route.methods, ['POST']);
    assert.equal(route.requestBody, 'buffered');
    assert.equal(typeof route.fetch, 'function');
  }
});

test('registerOfficeRoutes returns one composite disposer', () => {
  const { ctx, state } = makeCtx();
  const dispose = registerOfficeRoutes(ctx);
  assert.equal(typeof dispose, 'function');
  assert.equal(state.routes.length, 2);
  dispose();
  assert.deepEqual(state.disposed.sort(), [COMMAND_ROUTE, SNAPSHOT_ROUTE]);
});

test('registerOfficeRoutes accepts an injected ledger', async () => {
  const { ctx, state } = makeCtx();
  const ledger = {
    entries: [],
    replay() { return undefined; },
    isInflight() { return false; },
    begin(id) { this.entries.push(['begin', id]); },
    finish(id) { this.entries.push(['finish', id]); },
    remember(id) { this.entries.push(['remember', id]); },
  };
  registerOfficeRoutes(ctx, { ledger });
  const route = state.routes.find((entry) => entry.path === COMMAND_ROUTE);
  const response = await route.fetch(new Request('http://127.0.0.1' + COMMAND_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r', method: 'cyberOffice/command', payload: { commandId: '2f1c3a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b', sessionId: 's', action: 'agent.interrupt', args: { target: 'dev' } } }),
  }));
  const body = await response.json();
  assert.equal(body.result.ok, false);
  assert.equal(body.result.error.code, 'office/team-unavailable');
  assert.deepEqual(ledger.entries.map((entry) => entry[0]), ['begin', 'finish']);
});
