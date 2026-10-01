import { PREVIEW_CACHE_POLICY } from './preview-cache-authority.js';
const BASE = 'http://100.71.151.105:5241';
const PREFIX = '/api/brain/preview/janitor/cache';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function createPreviewCacheClient({ token = process.env.DEPLOY_TOKEN, base = BASE, transport = fetch } = {}) {
  // base仅供进程内fixture注入，生产固定MMV；不接受API参数或机器任意地址。
  async function request(path, body, signal) {
    if (!token) throw new Error('PREVIEW_TOKEN_MISSING');
    const response = await transport(`${base}${PREFIX}${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('PREVIEW_REQUEST_UNCONFIRMED');
    const text = await response.text(); if (text.length > 262144) throw new Error('PREVIEW_RESPONSE_TOO_LARGE');
    return JSON.parse(text);
  }
  return Object.freeze({
    plan: signal => request('/plan', { policy: PREVIEW_CACHE_POLICY }, signal),
    execute: (input, signal) => request('/execute', input, signal),
    receipt: (intent, signal) => { if (!UUID.test(intent)) throw new Error('INVALID_INTENT'); return request(`/receipts/${intent}`, null, signal); },
  });
}
