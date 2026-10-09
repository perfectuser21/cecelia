// PR 预览环境：每个 PR 由 CI（preview-deploy.yml）在 MMV 起一套隔离环境——PR 版本的 Brain（BRAIN_PREVIEW、跑迁移、
// 无后台自动化）+ 打包好的 Dashboard + 克隆库 cecelia_preview_<pr>。evaluator 在这里像真人一样验收。
// 状态查询：GET <api>/api/brain/preview/status/<pr> → { status, port }；预览进程与 evaluator 同机（MMV），用 localhost:<port>。
export const DEFAULT_PREVIEW_API = 'http://100.71.151.105:5241';
const REQUEST_TIMEOUT_MS = 10000;
const PENDING = new Set(['pending', 'starting', 'deploying', 'building', 'queued', 'restarting']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一次查询 → { state: 'active'|'pending'|'down'|'missing'|'error', url?, port?, status? } */
export async function previewOf(pr, { api = DEFAULT_PREVIEW_API, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${String(api).replace(/\/+$/, '')}/api/brain/preview/status/${encodeURIComponent(pr)}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    return { state: 'error', error: String(error?.message || error) };
  }
  if (res.status === 404) return { state: 'missing' };
  if (!res.ok) return { state: 'error', error: `http_${res.status}` };
  const body = await res.json().catch(() => null);
  const status = body?.status ?? null;
  const port = Number(body?.port);
  if (status === 'active' && Number.isInteger(port) && port > 0) return { state: 'active', url: `http://localhost:${port}`, port };
  if (PENDING.has(status)) return { state: 'pending', status };
  return { state: 'down', status };
}

/** 等到 active；down/missing 立刻返回（等也没用），pending/error 轮询到超时后返回最后状态。 */
export async function waitPreview(pr, { timeoutMs = 20 * 60 * 1000, intervalMs = 15000, ...opts } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const p = await previewOf(pr, opts);
    if (p.state === 'active' || p.state === 'down' || p.state === 'missing') return p;
    if (Date.now() + intervalMs > deadline) return p;
    await sleep(intervalMs);
  }
}
