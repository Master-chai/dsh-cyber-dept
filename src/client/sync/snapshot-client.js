import { SNAPSHOT_ROUTE, SNAPSHOT_METHOD } from '../../shared/contract.js';
import { isObject, text } from '../common.js';
import { fetchOfficeText, nextRpcId } from '../transport.js';
import { normalizeSnapshot } from '../model/normalize.js';

const MAX_RESPONSE_LENGTH = 8 * 1024 * 1024;

function resultErrorText(result) {
  if (!isObject(result)) return '宿主响应缺少 result';
  if (typeof result.error === 'string') return result.error;
  return isObject(result.error) ? text(result.error.message) || text(result.error.code) || '宿主返回 ok=false' : '宿主返回 ok=false';
}

/** Compatibility negotiation belongs to the RPC adapter, never the page. */
export function createSnapshotClient({ request = fetchOfficeText, rpcId = nextRpcId } = {}) {
  let scopedSnapshotsSupported = true;
  async function loadSnapshot(signal, sessionId) {
    const payload = sessionId ? { sessionId } : {};
    if (sessionId && scopedSnapshotsSupported) payload.currentOnly = true;
    const envelope = { type: 'client-request', rpcId: rpcId(), method: SNAPSHOT_METHOD, payload };
    const { response, raw } = await request(SNAPSHOT_ROUTE, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(envelope), signal,
    }, 8000);
    // An older still-running host may not yet understand currentOnly.
    if (response.status === 400 && payload.currentOnly && raw.includes('unexpected-payload-key:currentOnly')) {
      scopedSnapshotsSupported = false;
      return loadSnapshot(signal, sessionId);
    }
    if (!response.ok) throw new Error('HTTP ' + response.status + '（' + SNAPSHOT_ROUTE + '）');
    if (!raw) throw new Error('空响应：' + SNAPSHOT_ROUTE);
    if (raw.length > MAX_RESPONSE_LENGTH) throw new Error('快照响应过大：' + raw.length + ' 字符');
    let body;
    try { body = JSON.parse(raw); } catch { throw new Error('响应不是 JSON：' + SNAPSHOT_ROUTE); }
    if (isObject(body) && body.type === 'server-response') {
      if (body.rpcId !== envelope.rpcId) throw new Error('rpcId 不匹配（响应可能被代理或缓存）');
      if (!isObject(body.result)) throw new Error('响应缺少 result');
      if (body.result.ok !== true) throw new Error(resultErrorText(body.result));
      return normalizeSnapshot(body.result.value);
    }
    return normalizeSnapshot(body);
  }
  return loadSnapshot;
}

export const loadSnapshot = createSnapshotClient();
