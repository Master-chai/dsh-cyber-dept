import { COMMAND_ROUTE, COMMAND_LEDGER_CAPACITY, OFFICE_ERROR, SERVER_RESPONSE, fail } from '../../shared/contract.js';
import { readCommandEnvelope } from './validation.js';
import { CommandLedger } from './ledger.js';
import { executeOfficeCommand } from './executor.js';

/**
 * Reply with one server-response envelope. Domain errors travel inside 'result'
 * so the client unwraps a single shape for every answer.
 * @param {string} rpcId
 * @param {any} result
 */
function respond(rpcId, result) {
  return Response.json(
    { type: SERVER_RESPONSE, rpcId, result },
    { headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Register POST /api/cyberOffice/command.
 *
 * The registration is a Cordis effect on the calling fiber (connection owns it),
 * so unloading the plugin removes the route.
 *
 * @param {any} ctx
 * @param {CommandLedger} [ledger]
 * @returns {unknown} the route registration's disposer
 */
export function registerCommandRoute(ctx, ledger = new CommandLedger(), options = {}) {
  return ctx.connection.fetch.register({
    path: COMMAND_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      const envelope = readCommandEnvelope(body);
      if (!envelope.ok) {
        return Response.json({ error: 'Invalid command envelope', reason: envelope.reason }, { status: 400 });
      }
      const { commandId } = envelope.payload;
      const replayed = ledger.replay(commandId);
      if (replayed !== undefined) return respond(envelope.rpcId, replayed);
      if (ledger.isInflight(commandId)) {
        return respond(envelope.rpcId, fail(OFFICE_ERROR.busy, 'The same command is already in flight; wait for its result.', {}));
      }
      if (ledger.inflight?.size >= COMMAND_LEDGER_CAPACITY) return respond(envelope.rpcId, fail(OFFICE_ERROR.busy, 'Too many unresolved commands; check their results first.', {}));
      ledger.begin(commandId);
      const result = await executeOfficeCommand(ctx, envelope.payload, {
        signal: request.signal, timeoutMs: options.timeoutMs,
        onSettled(settled) {
          if (settled.ok || settled.error?.details?.deliveryUnknown) ledger.remember(commandId, settled);
          ledger.finish(commandId);
        },
      });
      return respond(envelope.rpcId, result);
    },
  });
}
