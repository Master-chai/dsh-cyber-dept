/**
 * HTTP surface of the office: the read snapshot and the write command, both on
 * the native Connection carrier.
 *
 * Route paths and envelope methods are fixed by the shared contract:
 *
 *   POST /api/cyberOffice/snapshot   method 'cyberOffice/snapshot'
 *   POST /api/cyberOffice/command    method 'cyberOffice/command'
 *
 * Envelope discipline (identical on both routes): a malformed body is the only
 * 400; every domain outcome is a 200 'server-response' with 'result.ok'
 * describing success or a stable office error code. Both routes are
 * 'cache-control: no-store' because every answer is a live read.
 *
 * @module dsh-cyber-dept/host/route
 */
import {
  CLIENT_REQUEST,
  MAX_ID_LENGTH,
  MAX_RPC_ID_LENGTH,
  OFFICE_ERROR,
  SERVER_RESPONSE,
  SNAPSHOT_METHOD,
  SNAPSHOT_ROUTE,
  fail,
  isPlainObject,
  ok,
} from '../shared/contract.js';
import { collectOffice, invalidateOfficeHistory } from './office.js';
import { CommandLedger, registerCommandRoute } from './command.js';

/**
 * Validate one client-request envelope for the snapshot route.
 *
 * The optional 'sessionId' names the floor the browser is standing on; it is
 * echoed back in 'current' so the client can highlight it without a second
 * request. Unknown payload keys are rejected: the read channel never grows a
 * parameter by accident.
 *
 * @param {unknown} body
 * @returns {{ok: true, rpcId: string, payload: {sessionId: string | null, currentOnly?: boolean}} | {ok: false, reason: string}}
 */
export function readSnapshotEnvelope(body) {
  if (!isPlainObject(body)) return { ok: false, reason: 'envelope-not-object' };
  if (body.type !== CLIENT_REQUEST) return { ok: false, reason: 'envelope-type' };
  if (typeof body.rpcId !== 'string' || body.rpcId.length === 0 || body.rpcId.length > MAX_RPC_ID_LENGTH) {
    return { ok: false, reason: 'envelope-rpc-id' };
  }
  if (body.method !== SNAPSHOT_METHOD) return { ok: false, reason: 'envelope-method' };
  const payload = body.payload;
  if (!isPlainObject(payload)) return { ok: false, reason: 'payload-not-object' };
  for (const key of Object.keys(payload)) {
    if (key !== 'sessionId' && key !== 'currentOnly') return { ok: false, reason: 'unexpected-payload-key:' + key };
  }
  let sessionId = null;
  if (payload.sessionId !== undefined && payload.sessionId !== null) {
    if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0 || payload.sessionId.length > MAX_ID_LENGTH) {
      return { ok: false, reason: 'payload-session-id' };
    }
    sessionId = payload.sessionId;
  }
  if (payload.currentOnly !== undefined && typeof payload.currentOnly !== 'boolean') return { ok: false, reason: 'payload-current-only' };
  if (payload.currentOnly === true && sessionId === null) return { ok: false, reason: 'payload-session-id' };
  return { ok: true, rpcId: body.rpcId, payload: { sessionId, ...(payload.currentOnly === true ? { currentOnly: true } : {}) } };
}

/** Reply with one server-response envelope. */
function respond(rpcId, result) {
  return Response.json(
    { type: SERVER_RESPONSE, rpcId, result },
    { headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Register POST /api/cyberOffice/snapshot.
 * @param {any} ctx
 * @returns {unknown} the route registration's disposer
 */
export function registerSnapshotRoute(ctx) {
  const subscriptions = typeof ctx.on === 'function' ? ['session/created', 'session/disposed', 'api-session/removed'].map(event => ctx.on(event, () => invalidateOfficeHistory(ctx))) : [];
  const dispose = ctx.connection.fetch.register({
    path: SNAPSHOT_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      const envelope = readSnapshotEnvelope(body);
      if (!envelope.ok) {
        return Response.json({ error: 'Invalid office request', reason: envelope.reason }, { status: 400 });
      }
      try {
        const value = await collectOffice(ctx, { sessionId: envelope.payload.sessionId, currentOnly: envelope.payload.currentOnly, signal: request.signal });
        return respond(envelope.rpcId, ok(value));
      } catch (error) {
        // collectOffice is written to degrade rather than throw; this is the
        // last line of defence so a composition bug cannot 500 the office tab.
        const message = error !== null && typeof error === 'object' && typeof error.message === 'string'
          ? error.message
          : String(error);
        return respond(envelope.rpcId, fail(OFFICE_ERROR.snapshotUnavailable, message, {}));
      }
    },
  });
  return () => { invalidateOfficeHistory(ctx); if (typeof dispose === 'function') dispose(); subscriptions.forEach(off => { if (typeof off === 'function') off(); }); };
}

/**
 * Whether a value already implements the ledger contract. Duck typing keeps the
 * injection point testable and lets a host supply its own bounded store; a plain
 * options bag ({capacity, ttlMs, now}) still constructs the default ledger.
 * @param {any} value
 */
function isCommandLedger(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.replay === 'function'
    && typeof value.begin === 'function'
    && typeof value.finish === 'function'
    && typeof value.remember === 'function'
    && typeof value.isInflight === 'function';
}

/**
 * Register both office routes. Returns one disposer so a caller can tear the
 * pair down as a unit (each route also owns its own fiber effect).
 * @param {any} ctx
 * @param {{ledger?: CommandLedger | {capacity?: number, ttlMs?: number, now?: () => number}}} [options]
 * @returns {() => void}
 */
export function registerOfficeRoutes(ctx, options = {}) {
  const ledger = isCommandLedger(options.ledger) ? options.ledger : new CommandLedger(options.ledger);
  const disposers = [registerSnapshotRoute(ctx), registerCommandRoute(ctx, ledger)];
  return () => {
    for (const dispose of disposers) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch {
        /* a fiber that is already gone needs no cleanup */
      }
    }
  };
}
