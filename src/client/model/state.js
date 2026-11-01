// @ts-check
// State dimensions remain independent; only the last step chooses the display.
// Task status must never be inferred from activity or availability.
/**
 * @typedef {Object} SeatStateInput
 * @property {boolean} [live]
 * @property {{phase?:string,state?:string}} [member]
 * @property {{state?:string}} [agent]
 * @property {unknown} [approval]
 * @property {unknown} [summary]
 * @property {boolean} [running]
 * @property {{status?:string,ready?:boolean}} [task]
 */

/** @param {SeatStateInput} input */
export function deriveSeatFacts(input) {
  const availability = input.live === false || input.member?.state === 'offline'
    ? 'offline' : input.live === true ? 'online' : 'unknown';
  const rosterPhase = input.member?.phase || '';
  const activity = input.approval ? 'waiting-approval'
    : input.agent?.state || input.member?.state || (input.running === true ? 'thinking' : input.summary ? 'idle' : 'offline');
  const taskStatus = input.task?.status || null;
  const taskBlocked = taskStatus === 'pending' && input.task?.ready === false;
  // Preserve the current display precedence: a cold floor dominates everything,
  // but provisioning/failure on a live floor must not be hidden by inactivity.
  const displayState = input.live === false ? 'offline'
    : rosterPhase === 'failed' ? 'error'
    : rosterPhase === 'provisioning' ? 'provisioning'
    : availability === 'offline' ? 'offline' : activity;
  return { availability, rosterPhase, activity, taskStatus, taskBlocked, displayState };
}

/** @param {SeatStateInput} input */
export function deriveSeatState(input) {
  return deriveSeatFacts(input).displayState;
}
