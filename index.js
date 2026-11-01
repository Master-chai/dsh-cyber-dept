/**
 * dsh-cyber-dept - the host half of the Cyber IT Department plugin.
 *
 * The plugin owns two things and nothing else:
 *
 * 1. the 'cyberAgent' session projection, a pure per-session fold that turns the
 *    committed log (turn/tool/approval boundaries) into one office state machine;
 * 2. two native Connection Fetch routes under /api/cyberOffice - a read snapshot
 *    that aggregates every department floor, and a write command channel that
 *    calls the Agent Teams service with the Lead identity of a live session.
 *
 * It never calls a model, never opens a port, never builds a WebSocket and never
 * appends Team events itself: reads come from the projection registry and
 * optional services, writes go through ctx.agentTeams, and the browser half
 * (./client) owns every pixel.
 *
 * @module dsh-cyber-dept
 */
import { PLUGIN_ID } from './src/shared/contract.js';
import { cyberAgentProjectionDefinition } from './src/host/projection.js';
import { registerOfficeRoutes } from './src/host/route.js';

/** Cordis plugin name. */
export const name = PLUGIN_ID;

/**
 * Required services. 'agentTeams', 'sessionProjectionCache' and 'sessions' are
 * deliberately absent: they depend on the profile composition, so the routes
 * probe them with ctx.get and degrade instead of blocking the plugin forever.
 */
export const inject = ['connection', 'sessionProjections', 'sessionQuery', 'agents'];

/**
 * Register the projection unit and both office routes. Every registration is an
 * effect on this plugin's fiber, so unloading removes the key and the routes.
 * @param {any} ctx
 */
export function apply(ctx) {
  ctx.sessionProjections.register(cyberAgentProjectionDefinition);
  registerOfficeRoutes(ctx);
}

export { cyberAgentProjectionDefinition };
