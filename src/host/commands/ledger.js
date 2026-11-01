import { COMMAND_LEDGER_CAPACITY, COMMAND_REPLAY_TTL_MS } from '../../shared/contract.js';

// Bounded replay of successful/uncertain results. In-flight locks end at actual settlement.
export class CommandLedger {
  /** @param {{capacity?: number, ttlMs?: number, now?: () => number}} [options] */
  constructor(options = {}) {
    this.capacity = Number.isSafeInteger(options.capacity) && options.capacity > 0 ? options.capacity : COMMAND_LEDGER_CAPACITY;
    // ttlMs 0 means "never expires", which is how tests pin capacity behaviour.
    this.ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : COMMAND_REPLAY_TTL_MS;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    /** @type {Map<string, {at: number, result: any}>} */
    this.results = new Map();
    /** @type {Set<string>} */
    this.inflight = new Set();
  }

  /** Number of replayable results currently held. */
  get size() {
    return this.results.size;
  }

  /**
   * The remembered result for a command id, or undefined. A hit refreshes LRU
   * recency; an expired entry is dropped on read.
   * @param {string} commandId
   * @returns {any}
   */
  replay(commandId) {
    const entry = this.results.get(commandId);
    if (entry === undefined) return undefined;
    if (this.ttlMs > 0 && this.now() - entry.at >= this.ttlMs) {
      this.results.delete(commandId);
      return undefined;
    }
    this.results.delete(commandId);
    this.results.set(commandId, entry);
    return entry.result;
  }

  /** @param {string} commandId */
  begin(commandId) {
    this.inflight.add(commandId);
  }

  /** @param {string} commandId */
  finish(commandId) {
    this.inflight.delete(commandId);
  }

  /** @param {string} commandId */
  isInflight(commandId) {
    return this.inflight.has(commandId);
  }

  /**
   * Remember one successful result, evicting the least recently used entry.
   * @param {string} commandId
   * @param {any} result
   * @returns {any}
   */
  remember(commandId, result) {
    this.results.delete(commandId);
    this.results.set(commandId, { at: this.now(), result });
    while (this.results.size > this.capacity) {
      const oldest = this.results.keys().next().value;
      if (oldest === undefined) break;
      this.results.delete(oldest);
    }
    return result;
  }

  clear() {
    this.results.clear();
    this.inflight.clear();
  }
}
