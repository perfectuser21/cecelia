# Langfuse Traces Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **TDD IRON LAW (Superpowers)**: NO PRODUCTION CODE WITHOUT FAILING TEST FIRST. 每 task 必须 git commit 顺序：commit-1 fail test / commit-2 impl. Throwaway prototype 才 skip — 你不是写 prototype。Controller 会 verify commit 顺序，不符合让你重做。

**Goal:** 在 Cecelia 中台 Dashboard 加 `/traces` 页面，从 Langfuse 拉最近 LLM 调用 trace 显示出来。

**Architecture:** Backend 加一条 `GET /api/brain/langfuse/recent` 路由（代理 Langfuse public API + Basic Auth + fail-soft），Frontend 加一个简单表格页面 + 30s polling，通过 system feature manifest 注册到 Dashboard nav。

**Tech Stack:** Node.js (ESM) + Express + Vitest（backend），React + TypeScript + @testing-library/react + Vitest（frontend）。

**Spec:** `docs/superpowers/specs/2026-04-29-langfuse-traces-page-design.md`

**Worktree:** `/Users/administrator/worktrees/cecelia/langfuse-traces-page`
**Branch:** `cp-04291800-langfuse-traces-page`（已 from origin/main，已有 docs commit `c0004e42d`）

---

## File Structure

**Create:**
- `packages/brain/scripts/smoke/langfuse-recent-smoke.sh` — E2E smoke (curl 真 brain)
- `packages/brain/src/routes/langfuse.js` — 路由实现 (~80 行)
- `packages/brain/src/routes/__tests__/langfuse.test.js` — 路由 integration test (mock fetch)
- `apps/api/features/system/pages/TracesPage.tsx` — 表格页面 (~120 行)
- `apps/api/features/system/pages/TracesPage.test.tsx` — 页面 unit test (sibling，按 features 约定)

**Modify:**
- `packages/brain/server.js` — 加 import + app.use 一行（line ~14 + ~301 附近）
- `apps/api/features/system/index.ts` — routes 数组 + components 各加一行

---

## Task 1: 写所有失败测试（Red commit-1）

**TDD IRON LAW：本 task 不写任何 production code，只写 test。所有测试必须 RUN 后看到 FAIL，再 commit。**

**Files:**
- Create: `packages/brain/scripts/smoke/langfuse-recent-smoke.sh`
- Create: `packages/brain/src/routes/__tests__/langfuse.test.js`
- Create: `apps/api/features/system/pages/TracesPage.test.tsx`

### Step 1.1: 写 smoke.sh（E2E 验证脚本）

- [ ] 创建文件 `packages/brain/scripts/smoke/langfuse-recent-smoke.sh`：

```bash
#!/usr/bin/env bash
# Smoke: Brain /api/brain/langfuse/recent 代理可用性
#
# 验证 Brain 暴露的 Langfuse trace 代理路由：
# 1. HTTP 200
# 2. body 含 success 字段
# 3. body 含 data 数组（fail-soft 保证：即使 Langfuse 不可达也返回 200 + data:[]）
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/langfuse/recent?limit=5"
OUT=/tmp/smoke-langfuse-recent.json

echo "▶️  smoke: langfuse-recent-smoke.sh"
echo "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" --max-time 10 "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ HTTP $HTTP_CODE (expected 200)"
  echo "   body:"
  cat "$OUT" 2>/dev/null || true
  exit 1
fi

for key in '"success"' '"data"'; do
  if ! grep -q "$key" "$OUT"; then
    echo "❌ Response missing $key field"
    echo "   body:"
    cat "$OUT"
    exit 1
  fi
done

echo "✅ smoke pass: $URL → 200, body has success+data"
cat "$OUT"
```

- [ ] `chmod +x packages/brain/scripts/smoke/langfuse-recent-smoke.sh`

- [ ] 跑 smoke 验证 FAIL（路由不存在 → 应该 404）：

```bash
cd /Users/administrator/worktrees/cecelia/langfuse-traces-page
bash packages/brain/scripts/smoke/langfuse-recent-smoke.sh
```

Expected: `❌ HTTP 404` 退出码 1（路由还没建）

### Step 1.2: 写 backend integration test

- [ ] 创建文件 `packages/brain/src/routes/__tests__/langfuse.test.js`：

```javascript
/**
 * routes/langfuse.test.js — integration test for /api/brain/langfuse
 *
 * Mocks global fetch and verifies route handler:
 *   - 成功路径：返回 success:true + data 数组
 *   - Langfuse 不可达：fail-soft 返回 success:false + data:[]
 *   - 凭据缺失：fail-soft 返回 success:false + error:'credentials_missing'
 *   - limit 上限：超过 100 时被截到 100
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import langfuseRouter from '../langfuse.js';

let app;

beforeEach(() => {
  app = express();
  app.use('/api/brain/langfuse', langfuseRouter);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function callApi(path) {
  const port = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv.address().port));
    app.locals._srv = srv;
  });
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    app.locals._srv.close();
  }
}

describe('GET /api/brain/langfuse/recent', () => {
  it('成功路径：返回 success:true + data 数组', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'trace-1', name: 'llm-call-cortex', timestamp: '2026-04-29T10:00:00Z' },
          { id: 'trace-2', name: 'llm-call-cortex', timestamp: '2026-04-29T10:01:00Z' },
        ],
      }),
    });
    const { status, body } = await callApi('/api/brain/langfuse/recent?limit=5');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toHaveProperty('id', 'trace-1');
    expect(body.data[0]).toHaveProperty('langfuseUrl');
  });

  it('Langfuse 不可达：fail-soft 返回 success:false + data:[]', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'));
    const { status, body } = await callApi('/api/brain/langfuse/recent');
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.data).toEqual([]);
    expect(body.error).toMatch(/ETIMEDOUT|unreachable/i);
  });

  it('Langfuse 401 返回 fail-soft', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });
    const { status, body } = await callApi('/api/brain/langfuse/recent');
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/auth|401/i);
  });

  it('limit 上限被截到 100', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });
    await callApi('/api/brain/langfuse/recent?limit=9999');
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(String(calledUrl)).toMatch(/limit=100\b/);
  });

  it('limit 默认 20', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });
    await callApi('/api/brain/langfuse/recent');
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(String(calledUrl)).toMatch(/limit=20\b/);
  });
});
```

- [ ] 跑 backend test 验证 FAIL（路由文件还不存在）：

```bash
cd /Users/administrator/worktrees/cecelia/langfuse-traces-page/packages/brain
npx vitest run src/routes/__tests__/langfuse.test.js
```

Expected: FAIL with import error (`Cannot find module '../langfuse.js'`)

### Step 1.3: 写 frontend page test

- [ ] 创建文件 `apps/api/features/system/pages/TracesPage.test.tsx`：

```typescript
/**
 * TracesPage.test.tsx — sibling test for TracesPage component.
 * 遵循 apps/api/features/ 现有最小约定：验证默认导出可加载。
 */
import { describe, it, expect } from 'vitest';

describe('TracesPage', () => {
  it('should export default component', async () => {
    const mod = await import('./TracesPage');
    expect(typeof mod.default).toBe('function');
  });
});
```

- [ ] 跑 frontend test 验证 FAIL：

```bash
cd /Users/administrator/worktrees/cecelia/langfuse-traces-page
npx vitest run apps/api/features/system/pages/TracesPage.test.tsx
```

Expected: FAIL with import error (`Cannot find module './TracesPage'`)

### Step 1.4: 三个测试都 fail 后 commit-1

- [ ] 确认 git status：

```bash
cd /Users/administrator/worktrees/cecelia/langfuse-traces-page
git status --short
```

Expected: 3 个 untracked 文件（smoke.sh + 2 个 test 文件）

- [ ] commit-1（Red commit）：

```bash
git add packages/brain/scripts/smoke/langfuse-recent-smoke.sh \
         packages/brain/src/routes/__tests__/langfuse.test.js \
         apps/api/features/system/pages/TracesPage.test.tsx

git commit -m "$(cat <<'EOF'
test(langfuse): 写失败的 smoke + integration + unit test [TDD commit-1]

按 spec 2026-04-29-langfuse-traces-page-design.md 的测试金字塔：
- smoke (E2E): packages/brain/scripts/smoke/langfuse-recent-smoke.sh
  → curl /api/brain/langfuse/recent，验证 HTTP 200 + body 含 success/data
- integration: packages/brain/src/routes/__tests__/langfuse.test.js
  → mock fetch 验证成功路径 / fail-soft / limit 上限 / 默认值
- unit: apps/api/features/system/pages/TracesPage.test.tsx
  → 验证默认导出（features 约定）

三个测试都跑过 RUN 确认 fail（路由 + 页面文件都不存在），符合 TDD Red。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `[cp-04291800-... abc1234] test(langfuse): ...`

---

## Task 2: 实现所有功能让测试 Green（commit-2）

**TDD IRON LAW：本 task 实现的每一行代码都必须让上一 task 的某个测试通过。如果实现后测试还是 fail，先修测试假设、再修实现，但**不允许**让 production code 走在没失败 test 之前。**

**Files:**
- Create: `packages/brain/src/routes/langfuse.js` (~80 行)
- Modify: `packages/brain/server.js` (+ 2 行)
- Create: `apps/api/features/system/pages/TracesPage.tsx` (~120 行)
- Modify: `apps/api/features/system/index.ts` (+ 5 行)

### Step 2.1: 实现 backend 路由

- [ ] 创建文件 `packages/brain/src/routes/langfuse.js`：

```javascript
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
```

- [ ] 跑 backend test 验证 PASS：

```bash
cd /Users/administrator/worktrees/cecelia/langfuse-traces-page/packages/brain
npx vitest run src/routes/__tests__/langfuse.test.js
```

Expected: 5 tests PASS

### Step 2.2: 在 server.js 挂载路由

- [ ] 编辑 `packages/brain/server.js`，在 line ~14 附近（已有 `import traceRoutes` 那块）加：

```javascript
import langfuseRoutes from './src/routes/langfuse.js';
```

- [ ] 在 line ~301 附近（已有 `app.use('/api/brain/trace', traceRoutes);`）加：

```javascript
app.use('/api/brain/langfuse', langfuseRoutes);
```

具体定位：找到 `import traceRoutes from './src/trace-routes.js';` 那行（line 14），下面紧贴一行加 langfuseRoutes import。然后找到 `app.use('/api/brain/trace', traceRoutes);` 那行（line 301），下面紧贴一行加 `app.use('/api/brain/langfuse', langfuseRoutes);`。

- [ ] 重启 brain 容器拿到新代码：

```bash
docker restart cecelia-node-brain
sleep 5
curl -s http://localhost:5221/api/brain/health | head -c 200
```

Expected: brain 健康 + uptime 重置

- [ ] 跑 smoke 验证 PASS：

```bash
bash /Users/administrator/worktrees/cecelia/langfuse-traces-page/packages/brain/scripts/smoke/langfuse-recent-smoke.sh
```

Expected: `✅ smoke pass: ... → 200, body has success+data`

### Step 2.3: 实现 TracesPage.tsx

- [ ] 创建文件 `apps/api/features/system/pages/TracesPage.tsx`：

```typescript
/**
 * TracesPage — 中台 Langfuse trace 列表
 *
 * 显示最近 50 条 LLM 调用 trace，30s polling 刷新。
 * 数据源：GET /api/brain/langfuse/recent?limit=50（中台代理 Langfuse public API）
 * 跳转：每条 trace 一键跳 Langfuse 详情页查完整堆栈。
 */
import { useEffect, useState, useCallback } from 'react';

interface Trace {
  id: string;
  name: string;
  timestamp: string;
  latencyMs: number | null;
  model: string | null;
  langfuseUrl: string;
}

interface ApiResp {
  success: boolean;
  data: Trace[];
  count?: number;
  error?: string;
}

const POLL_INTERVAL_MS = 30_000;
const LIMIT = 50;

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

function formatLatency(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function TracesPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/brain/langfuse/recent?limit=${LIMIT}`);
      const body: ApiResp = await res.json();
      if (body.success) {
        setTraces(body.data || []);
        setError(null);
      } else {
        setError(body.error || 'unknown_error');
        setTraces(body.data || []);
      }
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Langfuse Traces</h1>
        <div className="text-sm text-gray-500">
          {lastUpdated && <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>}
          <span className="mx-2">·</span>
          <span>{traces.length} traces</span>
          <button
            type="button"
            className="ml-3 px-3 py-1 rounded border text-sm hover:bg-gray-50"
            onClick={load}
            disabled={loading}
          >
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
          ⚠️ Langfuse 取数错误: <code>{error}</code>
          （服务地址：<a href="http://100.86.118.99:3000" target="_blank" rel="noreferrer" className="underline">http://100.86.118.99:3000</a>）
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-gray-600">
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Latency</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-400">
                  暂无 trace。请检查 Langfuse 服务: http://100.86.118.99:3000
                </td>
              </tr>
            )}
            {traces.map((t) => (
              <tr key={t.id} className="border-b hover:bg-gray-50">
                <td className="py-2 pr-4 font-mono text-xs">{formatTime(t.timestamp)}</td>
                <td className="py-2 pr-4">
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{t.name}</span>
                </td>
                <td className="py-2 pr-4 text-gray-500 text-xs">{t.model || '—'}</td>
                <td className="py-2 pr-4 font-mono text-xs">{formatLatency(t.latencyMs)}</td>
                <td className="py-2 pr-4">
                  <a
                    href={t.langfuseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline text-xs"
                  >
                    查看详情 ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] 跑 frontend test 验证 PASS：

```bash
cd /Users/administrator/worktrees/cecelia/langfuse-traces-page
npx vitest run apps/api/features/system/pages/TracesPage.test.tsx
```

Expected: 1 test PASS

### Step 2.4: 在 system feature manifest 注册路由 + nav

- [ ] 编辑 `apps/api/features/system/index.ts`：在 routes 数组里（line ~52 附近的最后一项 `{ path: '/performance', component: 'PerformanceMonitoring' },` 之后）加：

```typescript
    // Langfuse Traces
    {
      path: '/traces',
      component: 'TracesPage',
      navItem: { label: 'Traces', icon: 'Activity', group: 'system', order: 6 },
    },
```

- [ ] 同文件 components 对象里（line ~63 附近 `FeatureMap: () => import('./pages/FeatureMap'),` 之后）加：

```typescript
    TracesPage: () => import('./pages/TracesPage'),
```

- [ ] 跑全部相关测试 + 项目级 lint：

```bash
cd /Users/administrator/worktrees/cecelia/langfuse-traces-page
npx vitest run packages/brain/src/routes/__tests__/langfuse.test.js
npx vitest run apps/api/features/system/pages/TracesPage.test.tsx
```

Expected: 6 tests PASS（5 backend + 1 frontend）

### Step 2.5: commit-2（Green commit）

- [ ] 检查所有变更：

```bash
git status --short
```

Expected:
```
M  apps/api/features/system/index.ts
A  apps/api/features/system/pages/TracesPage.tsx
M  packages/brain/server.js
A  packages/brain/src/routes/langfuse.js
```

- [ ] commit-2：

```bash
git add apps/api/features/system/index.ts \
         apps/api/features/system/pages/TracesPage.tsx \
         packages/brain/server.js \
         packages/brain/src/routes/langfuse.js

git commit -m "$(cat <<'EOF'
feat(langfuse): 中台 /traces 页面 + /api/brain/langfuse/recent 路由 [TDD commit-2]

让 Cecelia Dashboard 能直接看 Langfuse 的 LLM trace（已有 105K 条）。

Backend:
- 新增 GET /api/brain/langfuse/recent?limit=N 路由
- 凭据从 ~/.credentials/langfuse.env 读，复用 langfuse-reporter 的 loadConfig 模式
- fail-soft：Langfuse 不可达/凭据缺失/401 时返 200 + success:false，不白屏前端

Frontend:
- 新增 TracesPage 组件：表格 + 30s polling + 跳 Langfuse 详情链接
- 注册到 system feature manifest 的 /traces 路由
- 错误态显示 banner 不阻止表格渲染

测试：commit-1 写的 smoke + integration + unit 现在全 PASS。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `[cp-04291800-... def5678] feat(langfuse): ...`

---

## Task 3: 真环境验证 + push + PR

**Files:** 无新文件，只是验证 + 提交。

### Step 3.1: 重启容器拿新代码 + 跑 smoke

- [ ] 重启 brain：

```bash
docker restart cecelia-node-brain
sleep 5
```

- [ ] 真环境跑 smoke：

```bash
bash /Users/administrator/worktrees/cecelia/langfuse-traces-page/packages/brain/scripts/smoke/langfuse-recent-smoke.sh
```

Expected: `✅ smoke pass`，body 显示真实 trace（应该有 5 条）

### Step 3.2: 浏览器验证（如果方便）

- [ ] （可选）手工开浏览器验证：

```
http://perfect21:5211/traces
```

Expected: 表格显示最近 50 条 trace，每条有"查看详情"链接跳 Langfuse。如果浏览器测不到（subagent 模式无浏览器），跳过此 step，由 PR review 时主理人自验。

### Step 3.3: lint 自检

- [ ] 本地跑 CI lint 自检：

```bash
cd /Users/administrator/worktrees/cecelia/langfuse-traces-page
bash .github/workflows/scripts/lint-tdd-commit-order.sh origin/main 2>&1 | tail -10
bash .github/workflows/scripts/lint-feature-has-smoke.sh origin/main 2>&1 | tail -10
bash .github/workflows/scripts/lint-test-pairing.sh origin/main 2>&1 | tail -10
```

Expected: 全 PASS

### Step 3.4: push + PR

- [ ] push：

```bash
git push -u origin cp-04291800-langfuse-traces-page
```

Expected: branch 推到 origin

- [ ] 创建 PR：

```bash
gh pr create --title "feat(langfuse): 中台 /traces 页面 — Dashboard 直读 Langfuse" --body "$(cat <<'EOF'
## Summary
- 新增 `GET /api/brain/langfuse/recent` 路由，代理 Langfuse public API（fail-soft）
- 新增 `/traces` 页面，表格展示最近 50 条 trace + 跳详情，30s polling
- 注册到 `system` feature manifest

## Why
主理人当前痛点：开发过程中"看不到现在在干什么"。Langfuse 已收集 105K 条 LLM trace（每次 LLM 调用通过 `langfuse-reporter.js` 自动上报），但 Cecelia Dashboard 从未把这些数据展示出来——Reporter 一边写、看不见。本 PR 把这条断链补完。

## Spec
`docs/superpowers/specs/2026-04-29-langfuse-traces-page-design.md`

## Test plan
- [ ] CI 全绿（含 lint-tdd-commit-order + lint-feature-has-smoke + real-env-smoke）
- [ ] 容器内 `bash packages/brain/scripts/smoke/langfuse-recent-smoke.sh` 真环境 PASS
- [ ] 浏览器 `http://perfect21:5211/traces` 看到最近 50 条 trace
- [ ] 任一行的 "查看详情" 跳转到正确的 `http://100.86.118.99:3000/trace/<id>`
- [ ] 模拟 Langfuse 不可达后页面显示 banner（不白屏）

## Out of scope
- LangGraph workflow 级 trace（v2）
- run_events 表整合（数据为空，无意义）
- 过滤/搜索/分页（v1）
- 修改 LiveMonitorPage（高风险）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL 输出，如 `https://github.com/perfectuser21/cecelia/pull/XXX`

### Step 3.5: 等 CI 完成

- [ ] 等 CI 完成（不要 admin merge）：

```bash
# 拿最新 SHA
HEAD_SHA=$(git rev-parse HEAD)

# 等所有 check 出现并完成
until gh api "repos/perfectuser21/cecelia/commits/$HEAD_SHA/check-runs" 2>&1 | jq -e '.total_count > 0' >/dev/null; do sleep 10; done
echo "Check runs detected, waiting for completion..."

gh pr checks --watch
```

Expected: 所有 check 全绿

---

## Self-Review Checklist

### Spec 覆盖检查
- ✅ Backend 路由（spec §三）→ Task 2 Step 2.1 + 2.2
- ✅ Frontend 页面（spec §四）→ Task 2 Step 2.3
- ✅ Manifest 注册（spec §四）→ Task 2 Step 2.4
- ✅ smoke (E2E)（spec §五）→ Task 1 Step 1.1
- ✅ Backend integration test（spec §五）→ Task 1 Step 1.2
- ✅ Frontend unit test（spec §五）→ Task 1 Step 1.3
- ✅ TDD commit 顺序（spec §六）→ Task 1 commit + Task 2 commit
- ✅ DoD（spec §九）→ Task 3 验证步骤

### Placeholder 扫描
- ✅ 无 TBD / TODO
- ✅ 每个 step 含完整代码 / 完整命令
- ✅ 没有 "similar to" 跳引用

### Type 一致性
- ✅ `Trace` interface 在前端 + 后端 mapping 一致（id/name/timestamp/latencyMs/model/langfuseUrl）
- ✅ `success: boolean / data: Trace[] / error?: string` 在 backend route + frontend ApiResp 一致
- ✅ 路径 `/api/brain/langfuse/recent` 在 smoke / integration test / frontend / server.js 全部一致
- ✅ `loadConfig` 函数名在 spec 引用 langfuse-reporter 时与本路由内联定义一致
