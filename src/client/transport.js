import { PLUGIN_ID } from '../shared/contract.js';

export function nextRpcId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* The host may not expose secure-context crypto. */ }
  return PLUGIN_ID + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** One bounded response read. Cancellation also settles callers when a transport ignores abort. */
export async function fetchOfficeText(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const signal = options.signal;
  if (signal?.aborted) throw signal.reason;
  let timer;
  let abort;
  const deadline = new Promise((_resolve, reject) => {
    abort = () => { controller.abort(signal.reason); reject(signal.reason); };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      const error = new Error('请求超时');
      error.name = 'TimeoutError';
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const raw = await response.text();
        return { response, raw };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}
