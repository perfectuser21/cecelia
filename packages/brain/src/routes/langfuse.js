/**
 * langfuse.js — Brain 中台代理 Langfuse public API
 *
 * 路由：
 *   GET /api/brain/langfuse/recent?limit=N (default 20, max 100)
 *
 * 凭据：从 ~/.credentials/langfuse.env 读取（容器内 mount 在
 *        /Users/administrator/.credentials/langfuse.env）
 *
 * Fail-soft：Langfuse 不可达 / 凭据缺失 / 401 时，HTTP 仍返 200，
 *            body 为 { success:false, data:[], error:'...' }，避免前端白屏。
 */
import { Router } from 'express';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const router = Router();

let _config = null;
let _initAttempted = false;

function loadConfig() {
  if (_initAttempted) return _config;
  _initAttempted = true;
  try {
    const credPath = join(homedir(), '.credentials', 'langfuse.env');
    const raw = readFileSync(credPath, 'utf-8');
    const cfg = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?([^"'\n]+)["']?$/);
      if (m) cfg[m[1]] = m[2];
    }
    if (cfg.LANGFUSE_PUBLIC_KEY && cfg.LANGFUSE_SECRET_KEY && cfg.LANGFUSE_BASE_URL) {
      _config = cfg;
    }
  } catch {
    // disabled
  }
  return _config;
}

// 仅测试用：reset cache（test 之间相互隔离）
export function _resetConfigCache() {
  _config = null;
  _initAttempted = false;
}

// 仅测试用：注入假 config，让测试在没有 ~/.credentials/langfuse.env 的环境（如 CI）下也能跑
export function _setConfigForTesting(cfg) {
  _config = cfg;
  _initAttempted = true;
}

/**
 * GET /api/brain/langfuse/recent
 */
router.get('/recent', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg) {
    return res.json({ success: false, data: [], error: 'credentials_missing' });
  }

  const rawLimit = parseInt(req.query.limit, 10) || 20;
  const limit = Math.max(1, Math.min(100, rawLimit));

  const auth = Buffer.from(`${cfg.LANGFUSE_PUBLIC_KEY}:${cfg.LANGFUSE_SECRET_KEY}`).toString('base64');
  const url = `${cfg.LANGFUSE_BASE_URL.replace(/\/$/, '')}/api/public/traces?limit=${limit}`;

  try {
    const lfRes = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!lfRes.ok) {
      const detail = lfRes.status === 401 || lfRes.status === 403 ? 'auth_failed' : `langfuse_${lfRes.status}`;
      return res.json({ success: false, data: [], error: detail });
    }

    const json = await lfRes.json();
    const items = Array.isArray(json.data) ? json.data : [];
    const baseUrl = cfg.LANGFUSE_BASE_URL.replace(/\/$/, '');

    const data = items.map((t) => ({
      id: t.id,
      name: t.name,
      timestamp: t.timestamp,
      latencyMs: t.latency || null,
      model: t.metadata?.model || null,
      metadata: t.metadata || null,
      langfuseUrl: `${baseUrl}/trace/${t.id}`,
    }));

    return res.json({ success: true, data, count: data.length });
  } catch (err) {
    return res.json({ success: false, data: [], error: err?.message || 'unreachable' });
  }
});

export default router;
