// @ts-check
import { currentOfficeFloor } from './selectors.js';

/**
 * @typedef {{id:string,members?:Array<{id?:string,sessionId?:string}>}} SnapshotFloor
 * @typedef {{state:string,floors:SnapshotFloor[],current?:{floorId?:string|null}}} SnapshotValue
 * @typedef {Object} SnapshotSyncOptions
 * @property {string} sessionId
 * @property {(signal:AbortSignal,sessionId:string)=>Promise<SnapshotValue>} load
 * @property {(value:SnapshotValue)=>void} onSnapshot
 * @property {(error:unknown)=>void} onError
 * @property {Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>|null} [visibility]
 * @property {typeof setTimeout} [schedule]
 * @property {typeof clearTimeout} [unschedule]
 * @property {number} [liveMs]
 * @property {number} [hiddenMs]
 * @property {number[]} [retries]
 */

/**
 * Owns one visible session's snapshot subscription. The load function and clock
 * are injected so stale response/cancellation behavior can be tested directly.
 * Native projections are subscribed separately and do not restart this poller.
 * @param {SnapshotSyncOptions} options
 */
export function createSnapshotSync({
  sessionId, load, onSnapshot, onError,
  visibility = typeof document === 'undefined' ? null : document,
  schedule = setTimeout, unschedule = clearTimeout,
  liveMs = 4000, hiddenMs = 15000, retries = [2000, 5000, 10000, 15000],
}) {
  let disposed = false, started = false, pending = false, failures = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {AbortController|null} */
  let controller = null;
  /** @param {number} delay */
  function later(delay) {
    if (disposed) return;
    if (timer !== null) unschedule(timer);
    timer = schedule(tick, delay);
  }
  async function tick() {
    if (disposed || pending) return;
    if (visibility?.hidden) { later(hiddenMs); return; }
    pending = true;
    controller = new AbortController();
    try {
      const value = await load(controller.signal, sessionId);
      if (disposed) return;
      if (value.state === 'unavailable' || (value.state === 'degraded' && !currentOfficeFloor(value.floors, value.current?.floorId || sessionId))) {
        throw new Error('当前团队数据暂不可用，请稍后重试。');
      }
      onSnapshot(value);
      failures = 0;
    } catch (error) {
      if (!disposed) { failures += 1; onError(error); }
    } finally {
      pending = false;
      later(failures ? retries[Math.min(failures - 1, retries.length - 1)] : liveMs);
    }
  }
  function visible() {
    if (!visibility?.hidden) {
      if (timer !== null) unschedule(timer);
      tick();
    }
  }
  return {
    start() {
      if (started || disposed || !sessionId) return;
      started = true;
      later(0); // Let navigation paint before starting host work.
      visibility?.addEventListener('visibilitychange', visible);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) unschedule(timer);
      controller?.abort();
      visibility?.removeEventListener('visibilitychange', visible);
    },
  };
}
