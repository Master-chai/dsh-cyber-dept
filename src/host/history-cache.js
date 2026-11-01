// Bounded per-host history index. Reads are shared; caller cancellation is isolated.
const historyCaches = new WeakMap();
export function createOfficeHistoryCache({ ttlMs = 5000, capacity = 10000, timeoutMs = 8000, now = Date.now } = {}) {
  let rows = null, expires = 0, pending = null, generation = 0;
  return {
    invalidate() { generation++; rows = null; expires = 0; pending = null; },
    async read(query, signal) {
      signal?.throwIfAborted();
      if (rows && now() < expires) return rows;
      if (!pending) {
        const version = generation;
        const controller = new AbortController();
        let timer;
        const deadline = new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            const error = new DOMException('Session history read timed out', 'TimeoutError');
            controller.abort(error);
            reject(error);
          }, timeoutMs);
        });
        const operation = Promise.race([Promise.resolve().then(() => query.listSessions(controller.signal)), deadline]).finally(() => clearTimeout(timer)).then(value => {
          const result = Array.isArray(value) ? value : [];
          if (version === generation && result.length <= capacity) { rows = result; expires = now() + ttlMs; }
          return result;
        });
        pending = operation;
        operation.finally(() => { if (pending === operation) pending = null; }).catch(() => {});
      }
      const operation = pending;
      if (!signal) return operation;
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
    },
  };
}
export function historyFor(ctx) {
  if (!historyCaches.has(ctx)) historyCaches.set(ctx, createOfficeHistoryCache());
  return historyCaches.get(ctx);
}
export function invalidateOfficeHistory(ctx) { historyCaches.get(ctx)?.invalidate(); }
