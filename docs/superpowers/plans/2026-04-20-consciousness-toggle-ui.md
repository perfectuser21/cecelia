# Consciousness Toggle UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Dashboard 加意识 toggle 按钮 + Brain 运行时热切换，不重启即生效。env 仍保留最高优先级（紧急逃生口）。

**Architecture:** 三级优先 `env.CONSCIOUSNESS_ENABLED=false > memory.consciousness_enabled > default`。guard 模块加 async init + cache + write-through setter，API 层新增 GET/PATCH `/api/brain/settings/consciousness`，Dashboard 配置驱动注册 `/settings` 路由 + Switch UI。

**Tech Stack:** Node.js ESM / PostgreSQL / Express / React + TS / Vitest

**Spec:** `docs/superpowers/specs/2026-04-20-consciousness-toggle-ui-design.md`

---

## File Structure

**新建**:
- `packages/brain/migrations/240_consciousness_setting.sql` — memory key 初始化
- `packages/brain/src/routes/settings.js` — GET/PATCH 意识开关
- `packages/brain/src/routes/settings.test.js` — 路由测试
- `apps/dashboard/src/pages/settings/SettingsPage.tsx` — UI 页
- `apps/dashboard/src/pages/settings/SettingsPage.test.tsx` — UI 测试

**修改**:
- `packages/brain/src/consciousness-guard.js` — 加 init/cache/setter/getter/reload
- `packages/brain/src/__tests__/consciousness-guard.test.js` — 扩展 env×memory 矩阵 + setter/getter 测试
- `packages/brain/server.js` — await initConsciousnessGuard + 挂 settingsRoutes
- `packages/brain/src/tick.js` — 每 2 分钟 reloadConsciousnessCache（容错 hook）
- `apps/dashboard/src/components/DynamicRouter.tsx` — 注册 SettingsPage lazy import
- `apps/api/*` — 如 Brain proxy 不是通配转发，则加 `/api/brain/settings/*` 透传
- `packages/brain/package.json` — 1.220.0 → 1.221.0
- `packages/brain/package-lock.json` — lockfile version 同步（手改顶层字段）
- `.brain-versions` — 同步
- `DEFINITION.md` — 版本 + §1.5 追加热切换说明

---

## Task 1: Migration 240 + working_memory 初始化

**Files:**
- Create: `packages/brain/migrations/240_consciousness_setting.sql`

- [ ] **Step 1.1: 写 migration**

Create `packages/brain/migrations/240_consciousness_setting.sql`:
```sql
-- Phase 2 of CONSCIOUSNESS_ENABLED: initialize runtime-toggle memory key.
-- Idempotent: existing value is preserved (manual set / prior Phase 2 deploy).
INSERT INTO working_memory (key, value, created_at, updated_at)
VALUES (
  'consciousness_enabled',
  '{"enabled": true, "last_toggled_at": null}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 1.2: 本地试跑 migration**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui
node packages/brain/src/migrate.js 2>&1 | tail -10
```
Expected: `✓ 240_consciousness_setting.sql` 或 `migrations up to date`。

如本 worktree 无 DB 连接（预期），跳过此步骤，由 Task 3 集成测试或合并后部署验证。

- [ ] **Step 1.3: Commit**

```bash
git add packages/brain/migrations/240_consciousness_setting.sql
git commit -m "feat(brain/migration): 240 initialize consciousness_enabled memory key

Phase 2 runtime-toggle 前置，idempotent（ON CONFLICT DO NOTHING）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: consciousness-guard 扩展（cache + init + setter/getter）

**Files:**
- Modify: `packages/brain/src/consciousness-guard.js`
- Modify: `packages/brain/src/__tests__/consciousness-guard.test.js`

- [ ] **Step 2.1: 扩展单测（TDD 红阶段）**

在 `packages/brain/src/__tests__/consciousness-guard.test.js` 末尾（`describe('consciousness-guard')` 内）加入新 describe 块：

```js
describe('memory-level toggle (Phase 2)', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
    };
  });

  test('initConsciousnessGuard loads value from working_memory', async () => {
    const { initConsciousnessGuard, isConsciousnessEnabled } = await import('../consciousness-guard.js');
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: { enabled: false, last_toggled_at: '2026-04-20T00:00:00Z' } }] });
    await initConsciousnessGuard(mockPool);
    expect(isConsciousnessEnabled()).toBe(false);
  });

  test('memory=false overrides default', async () => {
    const { initConsciousnessGuard, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
    _resetCacheForTest();
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: { enabled: false, last_toggled_at: null } }] });
    await initConsciousnessGuard(mockPool);
    expect(isConsciousnessEnabled()).toBe(false);
  });

  test('env=false overrides memory=true (escape hatch)', async () => {
    const { initConsciousnessGuard, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
    _resetCacheForTest();
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: { enabled: true, last_toggled_at: null } }] });
    await initConsciousnessGuard(mockPool);
    process.env.CONSCIOUSNESS_ENABLED = 'false';
    expect(isConsciousnessEnabled()).toBe(false);
  });

  test('setConsciousnessEnabled writes DB and updates cache', async () => {
    const { initConsciousnessGuard, setConsciousnessEnabled, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
    _resetCacheForTest();
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: { enabled: true, last_toggled_at: null } }] });
    await initConsciousnessGuard(mockPool);
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // setter write
    const status = await setConsciousnessEnabled(mockPool, false);
    expect(status.enabled).toBe(false);
    expect(status.last_toggled_at).toBeTruthy();
    expect(isConsciousnessEnabled()).toBe(false);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  test('getConsciousnessStatus includes env_override flag', async () => {
    const { getConsciousnessStatus } = await import('../consciousness-guard.js');
    process.env.CONSCIOUSNESS_ENABLED = 'false';
    expect(getConsciousnessStatus().env_override).toBe(true);
    delete process.env.CONSCIOUSNESS_ENABLED;
    expect(getConsciousnessStatus().env_override).toBe(false);
    process.env.BRAIN_QUIET_MODE = 'true';
    expect(getConsciousnessStatus().env_override).toBe(true);
  });

  test('reloadConsciousnessCache picks up external DB changes', async () => {
    const { initConsciousnessGuard, reloadConsciousnessCache, isConsciousnessEnabled, _resetCacheForTest } = await import('../consciousness-guard.js');
    _resetCacheForTest();
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: { enabled: true, last_toggled_at: null } }] });
    await initConsciousnessGuard(mockPool);
    expect(isConsciousnessEnabled()).toBe(true);
    mockPool.query.mockResolvedValueOnce({ rows: [{ value: { enabled: false, last_toggled_at: '2026-04-20T01:00:00Z' } }] });
    await reloadConsciousnessCache(mockPool);
    expect(isConsciousnessEnabled()).toBe(false);
  });
});
```

**还要在现有顶部 `beforeEach` 末尾补一行** 以确保测试隔离：
```js
beforeEach(() => {
  delete process.env.CONSCIOUSNESS_ENABLED;
  delete process.env.BRAIN_QUIET_MODE;
  _resetDeprecationWarn();
  // 新加：
  const g = require('../consciousness-guard.js');
  if (g._resetCacheForTest) g._resetCacheForTest();
});
```

（ESM 下用 `require` 可能不行，改用 top-level import + 调 `_resetCacheForTest()`。实施时按实际 import 风格调整。）

- [ ] **Step 2.2: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui/packages/brain
npx vitest run src/__tests__/consciousness-guard.test.js 2>&1 | tail -15
```
Expected: 6 new tests 失败，报 `initConsciousnessGuard is not a function` 等。

- [ ] **Step 2.3: 扩展 consciousness-guard.js**

Edit `packages/brain/src/consciousness-guard.js` 在文件末尾（`_resetDeprecationWarn` 之后）加：

```js
// ========== Phase 2: Runtime toggle via working_memory ==========

let _cached = null; // { enabled: bool, last_toggled_at: ISO | null }
let _initialized = false;

const MEMORY_KEY = 'consciousness_enabled';

/**
 * 从 working_memory 加载开关状态到模块缓存。
 * 必须在 server.js 的 app.listen 之前 await 完成。
 */
export async function initConsciousnessGuard(pool) {
  try {
    const result = await pool.query(
      `SELECT value FROM working_memory WHERE key = $1`,
      [MEMORY_KEY]
    );
    const val = result.rows[0]?.value;
    _cached = val || { enabled: true, last_toggled_at: null };
  } catch (err) {
    console.warn('[consciousness-guard] initConsciousnessGuard failed, using default:', err.message);
    _cached = { enabled: true, last_toggled_at: null };
  }
  _initialized = true;
}

export async function setConsciousnessEnabled(pool, enabled) {
  const value = { enabled: !!enabled, last_toggled_at: new Date().toISOString() };
  await pool.query(
    `INSERT INTO working_memory(key, value, created_at, updated_at)
     VALUES($1, $2::jsonb, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [MEMORY_KEY, JSON.stringify(value)]
  );
  _cached = value;
  console.log(`[Brain] Consciousness toggled → ${enabled} at ${value.last_toggled_at}`);
  return getConsciousnessStatus();
}

export function getConsciousnessStatus() {
  const envOverride =
    process.env.CONSCIOUSNESS_ENABLED === 'false' ||
    process.env.BRAIN_QUIET_MODE === 'true';
  return {
    enabled: isConsciousnessEnabled(),
    last_toggled_at: _cached?.last_toggled_at || null,
    env_override: envOverride,
  };
}

export async function reloadConsciousnessCache(pool) {
  try {
    const result = await pool.query(
      `SELECT value FROM working_memory WHERE key = $1`,
      [MEMORY_KEY]
    );
    const val = result.rows[0]?.value;
    if (val) _cached = val;
  } catch (err) {
    console.warn('[consciousness-guard] reload failed (non-fatal):', err.message);
  }
}

// Test-only: reset cache for beforeEach
export function _resetCacheForTest() {
  _cached = null;
  _initialized = false;
}
```

**同时修改 `isConsciousnessEnabled()`** 让它读 cache。找到现有函数：

```js
export function isConsciousnessEnabled() {
  // 新 env 优先
  if (process.env.CONSCIOUSNESS_ENABLED === 'false') return false;
  if (process.env.CONSCIOUSNESS_ENABLED === 'true') return true;
  // Deprecated: 旧 BRAIN_QUIET_MODE=true 作为别名
  if (process.env.BRAIN_QUIET_MODE === 'true') {
    if (!_deprecationWarned) { ... }
    return false;
  }
  return true;
}
```

改成：

```js
export function isConsciousnessEnabled() {
  // env override 永远优先（紧急逃生口）
  if (process.env.CONSCIOUSNESS_ENABLED === 'false') return false;
  if (process.env.BRAIN_QUIET_MODE === 'true') {
    if (!_deprecationWarned) {
      console.warn('[consciousness-guard] BRAIN_QUIET_MODE is deprecated, use CONSCIOUSNESS_ENABLED=false');
      _deprecationWarned = true;
    }
    return false;
  }
  // env 强制 true 也算 override
  if (process.env.CONSCIOUSNESS_ENABLED === 'true') return true;
  // memory 权威
  if (_initialized && _cached) return _cached.enabled !== false;
  // 默认
  return true;
}
```

- [ ] **Step 2.4: 跑测试确认通过**

```bash
npx vitest run src/__tests__/consciousness-guard.test.js 2>&1 | tail -10
```
Expected: 16 tests passed（原 10 + 新 6）。

- [ ] **Step 2.5: Commit**

```bash
git add packages/brain/src/consciousness-guard.js packages/brain/src/__tests__/consciousness-guard.test.js
git commit -m "feat(brain/consciousness-guard): add runtime cache + memory-backed toggle

- initConsciousnessGuard(pool): async load from working_memory
- setConsciousnessEnabled(pool, val): DB write-through + cache update + log
- getConsciousnessStatus(): returns {enabled, last_toggled_at, env_override}
- reloadConsciousnessCache(pool): tick-level fault tolerance
- isConsciousnessEnabled() 改为三级优先：env override > memory > default
- 16 tests passed（原 10 + 新 6）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: server.js 启动时 await init + tick 加 reload

**Files:**
- Modify: `packages/brain/server.js`
- Modify: `packages/brain/src/tick.js`

- [ ] **Step 3.1: server.js 加 await init**

Edit `packages/brain/server.js`。找到现有 import 段：
```js
import { isConsciousnessEnabled, logStartupDeclaration } from './src/consciousness-guard.js';
```
改为：
```js
import { isConsciousnessEnabled, logStartupDeclaration, initConsciousnessGuard } from './src/consciousness-guard.js';
```

在 `logStartupDeclaration();` 调用之前加：
```js
  await initConsciousnessGuard(pool);
  logStartupDeclaration();
```

（确保 logStartupDeclaration 调用点位于一个 async 函数/顶层 await 作用域内。如现有代码是顶层 await 在 `async function main()` 或类似里，位置不变；如是纯同步，整个启动块要包成 async IIFE——照现有代码模式。）

- [ ] **Step 3.2: tick.js 加 reload 每 2 分钟**

Edit `packages/brain/src/tick.js`。在 import 段加：
```js
import { reloadConsciousnessCache } from './consciousness-guard.js';
```

在 tick 主体合适位置（比如 `_lastPipelineWatchdogTime` 同级的 interval 逻辑附近）加：
```js
// Consciousness guard cache reload（每 2 分钟，容错 hook）
const CONSCIOUSNESS_RELOAD_INTERVAL_MS = 2 * 60 * 1000;
let _lastConsciousnessReload = 0;
// ... 在 tick 函数内：
if (Date.now() - _lastConsciousnessReload >= CONSCIOUSNESS_RELOAD_INTERVAL_MS) {
  _lastConsciousnessReload = Date.now();
  Promise.resolve().then(() => reloadConsciousnessCache(pool))
    .catch(e => console.warn('[tick] consciousness reload failed:', e.message));
}
```

放在已有 `pipelineWatchdogElapsed` 判断附近，用相同模式。

- [ ] **Step 3.3: node --check 语法**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui
node --check packages/brain/server.js
node --check packages/brain/src/tick.js
```
Expected: 无输出

- [ ] **Step 3.4: 跑全 brain 单测无回归**

```bash
cd packages/brain
npx vitest run src/__tests__/consciousness-guard.test.js src/__tests__/tick-consciousness-guard.test.js src/__tests__/harness-pipeline.test.ts 2>&1 | tail -5
```
Expected: 全绿（不低于 Task 2 的 16 + 已有 tick/harness）。

- [ ] **Step 3.5: Commit**

```bash
cd ..
git add packages/brain/server.js packages/brain/src/tick.js
git commit -m "feat(brain): await initConsciousnessGuard at startup + tick reload cache

- server.js: 在 logStartupDeclaration 前 await initConsciousnessGuard(pool)
- tick.js: 每 2 分钟 reloadConsciousnessCache（容错 hook，防外部改 DB）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Brain API `/api/brain/settings/consciousness`

**Files:**
- Create: `packages/brain/src/routes/settings.js`
- Create: `packages/brain/src/__tests__/routes-settings.test.js`
- Modify: `packages/brain/server.js`

- [ ] **Step 4.1: 写失败测试**

Create `packages/brain/src/__tests__/routes-settings.test.js`:
```js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../consciousness-guard.js', () => ({
  getConsciousnessStatus: vi.fn(),
  setConsciousnessEnabled: vi.fn(),
}));

describe('routes/settings.js', () => {
  let app, getStatus, setEnabled;

  beforeEach(async () => {
    vi.clearAllMocks();
    getStatus = (await import('../consciousness-guard.js')).getConsciousnessStatus;
    setEnabled = (await import('../consciousness-guard.js')).setConsciousnessEnabled;
    const router = (await import('../routes/settings.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/brain/settings', router);
  });

  test('GET /consciousness returns status', async () => {
    getStatus.mockReturnValueOnce({ enabled: true, last_toggled_at: null, env_override: false });
    const res = await request(app).get('/api/brain/settings/consciousness');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, last_toggled_at: null, env_override: false });
  });

  test('PATCH /consciousness with boolean works', async () => {
    setEnabled.mockResolvedValueOnce({ enabled: false, last_toggled_at: '2026-04-20T01:00:00Z', env_override: false });
    const res = await request(app).patch('/api/brain/settings/consciousness').send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(setEnabled).toHaveBeenCalledWith(expect.anything(), false);
  });

  test('PATCH with non-boolean returns 400', async () => {
    const res = await request(app).patch('/api/brain/settings/consciousness').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/);
  });

  test('PATCH without enabled field returns 400', async () => {
    const res = await request(app).patch('/api/brain/settings/consciousness').send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4.2: 跑失败**

```bash
cd packages/brain
npx vitest run src/__tests__/routes-settings.test.js 2>&1 | tail -10
```
Expected: 失败 `Cannot find module '../routes/settings.js'`。

如 supertest 未安装，先装：`npm install --save-dev supertest` in packages/brain（如果 package.json 已有跳过）。

- [ ] **Step 4.3: 创建 routes/settings.js**

Create `packages/brain/src/routes/settings.js`:
```js
import { Router } from 'express';
import pool from '../db.js';
import { getConsciousnessStatus, setConsciousnessEnabled } from '../consciousness-guard.js';

const router = Router();

router.get('/consciousness', (req, res) => {
  res.json(getConsciousnessStatus());
});

router.patch('/consciousness', async (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  try {
    const status = await setConsciousnessEnabled(pool, enabled);
    res.json(status);
  } catch (err) {
    console.error('[settings/consciousness] PATCH failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 4.4: server.js 挂接**

Edit `packages/brain/server.js`。在现有 `import memoryRoutes ...` 附近加：
```js
import settingsRoutes from './src/routes/settings.js';
```

在 `app.use('/api/brain/memory', memoryRoutes);` 附近加：
```js
app.use('/api/brain/settings', settingsRoutes);
```

- [ ] **Step 4.5: 跑测试通过**

```bash
cd packages/brain
npx vitest run src/__tests__/routes-settings.test.js 2>&1 | tail -8
```
Expected: 4 tests passed

- [ ] **Step 4.6: Commit**

```bash
cd ..
git add packages/brain/src/routes/settings.js packages/brain/src/__tests__/routes-settings.test.js packages/brain/server.js
git commit -m "feat(brain/api): GET/PATCH /api/brain/settings/consciousness

- 新 routes/settings.js 路由
- server.js 挂接 /api/brain/settings
- 4 tests: GET / PATCH valid / PATCH invalid body / PATCH missing field

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: apps/api proxy（若需要）

**Files:**
- Possibly modify: `apps/api/**`

- [ ] **Step 5.1: 探测现有 Brain proxy 模式**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui
grep -rn "localhost:5221\|api/brain\|BRAIN_URL" apps/api/src/ 2>&1 | head -15
grep -rn "http-proxy-middleware\|fetch.*brain" apps/api/src/ 2>&1 | head -10
```

- [ ] **Step 5.2: 判断是否需要改**

如果 apps/api 有通配转发（如 `/api/brain/*` 全部 proxy 到 `BRAIN_URL`），**本 Task 跳过 commit，纯 no-op**。

如果是白名单模式（只列了特定端点），需要加 `/api/brain/settings/consciousness` 到白名单。参考现有条目加一条。

- [ ] **Step 5.3: 如需改动则 commit**

```bash
git add apps/api/
git commit -m "feat(api): proxy /api/brain/settings/consciousness to Brain

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

如无改动，跳过 commit。

---

## Task 6: Dashboard `/settings` 页 + Switch UI

**Files:**
- Create: `apps/dashboard/src/pages/settings/SettingsPage.tsx`
- Create: `apps/dashboard/src/pages/settings/SettingsPage.test.tsx`
- Modify: `apps/dashboard/src/components/DynamicRouter.tsx`
- Possibly modify: nav config（看 InstanceContext 是否从 Brain 拿）

- [ ] **Step 6.1: 查 Dashboard DynamicRouter + nav 注册方式**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui
cat apps/dashboard/src/components/DynamicRouter.tsx | head -60
grep -rn "SettingsPage\|component.*=.*'BrainModelsPage'" apps/dashboard/src/ 2>&1 | head -10
```

根据输出决定 component 映射加在哪。Cecelia 模式是"component 字符串 → lazy import"映射表，可能在 `DynamicRouter.tsx` 或 `componentMap.ts`。

- [ ] **Step 6.2: 创建 SettingsPage.tsx**

Create `apps/dashboard/src/pages/settings/SettingsPage.tsx`:
```tsx
import { useEffect, useState } from 'react';

type Status = {
  enabled: boolean;
  last_toggled_at: string | null;
  env_override: boolean;
};

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brain/settings/consciousness')
      .then(r => r.json())
      .then(setStatus)
      .catch(e => setError(e.message));
  }, []);

  const toggle = async () => {
    if (!status || status.env_override) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/brain/settings/consciousness', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      const next = await res.json();
      setStatus(next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!status) return <div style={{ padding: 24 }}>Loading...</div>;

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>设置</h2>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>意识开关</h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              {status.enabled
                ? '开 — Brain 会做情绪 / 反思 / 自驱 / 日记等活动（消耗 LLM token）'
                : '关 — Brain 只做任务派发 / 调度 / 监控（不消耗意识层 token）'}
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            disabled={loading || status.env_override}
            data-testid="consciousness-toggle"
            aria-pressed={status.enabled}
            style={{
              width: 56, height: 32, borderRadius: 16, border: 'none',
              background: status.enabled ? '#10b981' : '#d1d5db',
              cursor: status.env_override ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              position: 'relative',
            }}
          >
            <span style={{
              position: 'absolute', top: 4, left: status.enabled ? 28 : 4,
              width: 24, height: 24, borderRadius: 12, background: '#fff',
              transition: 'left 0.15s',
            }} />
          </button>
        </div>

        {status.last_toggled_at && (
          <p style={{ fontSize: 12, color: '#9ca3af' }}>
            上次切换：{new Date(status.last_toggled_at).toLocaleString('zh-CN')}
          </p>
        )}

        {status.env_override && (
          <div style={{ marginTop: 12, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }} data-testid="env-override-warning">
            <p style={{ fontSize: 13, color: '#991b1b', fontWeight: 500 }}>⚠️ Plist 强制关闭</p>
            <p style={{ fontSize: 12, color: '#7f1d1d', marginTop: 4 }}>
              主机 plist 设置了 <code>CONSCIOUSNESS_ENABLED=false</code> 或 <code>BRAIN_QUIET_MODE=true</code>，
              本界面无法控制。需 SSH 到主机 unset env 才能恢复 Dashboard 控制。
            </p>
          </div>
        )}

        {error && (
          <p style={{ marginTop: 12, fontSize: 13, color: '#dc2626' }}>错误：{error}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6.3: 创建测试**

Create `apps/dashboard/src/pages/settings/SettingsPage.test.tsx`:
```tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test('renders status after fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      enabled: true, last_toggled_at: null, env_override: false,
    }), { status: 200 }));
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/意识开关/)).toBeInTheDocument());
    expect(screen.getByTestId('consciousness-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('click toggle sends PATCH', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, last_toggled_at: null, env_override: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false, last_toggled_at: '2026-04-20T01:00:00Z', env_override: false }), { status: 200 }));
    render(<SettingsPage />);
    await waitFor(() => screen.getByTestId('consciousness-toggle'));
    fireEvent.click(screen.getByTestId('consciousness-toggle'));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/brain/settings/consciousness',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ enabled: false }),
        }),
      );
    });
  });

  test('env_override disables toggle + shows warning', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      enabled: false, last_toggled_at: null, env_override: true,
    }), { status: 200 }));
    render(<SettingsPage />);
    await waitFor(() => screen.getByTestId('env-override-warning'));
    expect(screen.getByTestId('consciousness-toggle')).toBeDisabled();
  });
});
```

- [ ] **Step 6.4: 注册 component 映射 + nav item**

Edit `apps/dashboard/src/components/DynamicRouter.tsx`（或同目录的 componentMap），找到类似：
```ts
const componentMap = {
  BrainModelsPage: lazy(() => import('../pages/brain-models/BrainModelsPage')),
  ...
};
```
加一行：
```ts
  SettingsPage: lazy(() => import('../pages/settings/SettingsPage')),
```

**Nav 注册**：Cecelia 的 nav 从 `InstanceContext.coreConfig.navGroups` 加载。如果这是从 Brain API 拿的，需要在 Brain 的 `coreConfig` 里加；如果是前端 hardcode fallback，就在 hardcode 处加。

grep 定位：
```bash
grep -rn "coreConfig.*navGroups\|navGroups.*:" apps/ packages/brain/ 2>&1 | head -10
```

根据位置加一个 nav item：
```ts
{
  path: '/settings',
  icon: Settings,  // from lucide-react
  label: '设置',
  featureKey: 'settings',
  component: 'SettingsPage',
}
```

如果 Cecelia 的 featureKey 机制要求入 DB，本 Task 暂用前端 hardcode fallback，运行时若 navGroups 无此项则注入（由 implementer subagent 决定具体实现）。

- [ ] **Step 6.5: 跑 Dashboard 测试**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui/apps/dashboard
npx vitest run src/pages/settings/SettingsPage.test.tsx 2>&1 | tail -10
```
Expected: 3 tests passed

- [ ] **Step 6.6: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui
git add apps/dashboard/src/pages/settings/ apps/dashboard/src/components/DynamicRouter.tsx
# + nav config 改动
git commit -m "feat(dashboard): add /settings page with consciousness toggle

- SettingsPage.tsx: Switch + last_toggled + env_override warning
- 3 vitest tests: render / click-PATCH / env_override disabled
- DynamicRouter 注册 SettingsPage lazy import
- nav '/settings' 菜单项

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 版本 bump + DEFINITION.md 更新

**Files:**
- Modify: `packages/brain/package.json` / `package-lock.json` / `.brain-versions` / `DEFINITION.md` / `brain-manifest.generated.json`

- [ ] **Step 7.1: bump 版本**

Edit `packages/brain/package.json`: `"version": "1.220.0"` → `"1.221.0"`.

Edit `.brain-versions`: `1.220.0` → `1.221.0`.

Edit `DEFINITION.md`: `Brain 版本: 1.220.0` → `1.221.0`.

- [ ] **Step 7.2: lockfile + manifest 同步**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui/packages/brain
node -e "const fs=require('fs');const p='./package-lock.json';const l=JSON.parse(fs.readFileSync(p));l.version='1.221.0';if(l.packages&&l.packages[''])l.packages[''].version='1.221.0';fs.writeFileSync(p,JSON.stringify(l,null,2)+'\n');"
cd ../..
node packages/brain/scripts/generate-manifest.mjs 2>&1 | tail -3
```

- [ ] **Step 7.3: DEFINITION.md §1.5 追加热切换说明**

找到 §1.5 意识守护段落末尾，追加：
```markdown

**运行时热切换（Phase 2）**：通过 Dashboard `/settings` 页或 API `PATCH /api/brain/settings/consciousness` 即时切换，无需重启。API 层写 `working_memory.consciousness_enabled` + 模块 cache write-through。**env 优先级**：plist 设 `CONSCIOUSNESS_ENABLED=false` 时 memory 被忽略（主机级紧急逃生口）。Dashboard 检测到 env_override=true 自动 disable Switch。
```

- [ ] **Step 7.4: DevGate 验证**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui
node scripts/facts-check.mjs 2>&1 | tail -5
bash scripts/check-version-sync.sh 2>&1 | tail -5
bash scripts/check-consciousness-guard.sh 2>&1 | tail -3
```
Expected: 全绿（`All facts consistent` / `All version files in sync` / `✅ 无裸读`）。

- [ ] **Step 7.5: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md packages/brain/src/brain-manifest.generated.json
git commit -m "chore(brain): bump 1.220.0 → 1.221.0 + DEFINITION.md Phase 2 note

- Minor bump: 新增运行时热切换特性
- DEFINITION.md §1.5 追加 Phase 2 说明（API + env override 优先级）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 全量回归 + PR size 检查

- [ ] **Step 8.1: 跑 brain 关键单测**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui/packages/brain
npx vitest run src/__tests__/consciousness-guard.test.js src/__tests__/routes-settings.test.js src/__tests__/tick-consciousness-guard.test.js src/__tests__/harness-pipeline.test.ts 2>&1 | tail -8
```
Expected: 全绿，总计 ≥ 23 tests。

- [ ] **Step 8.2: 跑 Dashboard 单测**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui/apps/dashboard
npx vitest run src/pages/settings/ 2>&1 | tail -5
```
Expected: 3/3 passed

- [ ] **Step 8.3: PR size 预估**

```bash
cd /Users/administrator/worktrees/cecelia/consciousness-toggle-ui
git diff --numstat origin/main..HEAD | awk '{a+=$1; d+=$2} END {print "total:", a+d, "(+"a" -"d")"}'
```
Expected: < 1500（硬门槛）。目标 < 800（因为 spec 200、plan 这份 ~600，代码 ~500，测试 ~300，总计 ~1600——如果超，删除 plan 的 commit 即可，参考上次经验）。

- [ ] **Step 8.4: 如 PR size > 1500，删除 plan 文档**

```bash
git rm docs/superpowers/plans/2026-04-20-consciousness-toggle-ui.md
git commit -m "docs: remove plan to stay under PR size limit (keep spec)"
```

---

## Self-Review

- [x] Spec §2.1 三级优先 → Task 2 Step 2.3 实现
- [x] Spec §2.2 async init / cache / setter / reload → Task 2
- [x] Spec §2.3 Migration 240 idempotent → Task 1
- [x] Spec §2.4 routes/settings GET/PATCH + 400 → Task 4
- [x] Spec §2.5 apps/api proxy → Task 5
- [x] Spec §2.6 Dashboard SettingsPage + nav + env_override warning → Task 6
- [x] Spec §3 测试（单测 + routes + integration + dashboard）→ Task 2/4/6
- [x] Spec §4 DoD 8 条 → Task 1-8 覆盖
- [x] env_override 语义保留 PR #2447 紧急逃生口 → Task 2 Step 2.3 `isConsciousnessEnabled` 优先级逻辑

**无 placeholder。命名一致（`isConsciousnessEnabled` / `setConsciousnessEnabled` / `getConsciousnessStatus` / `initConsciousnessGuard` / `reloadConsciousnessCache`）。**

---

**Plan 完成。保存到 `docs/superpowers/plans/2026-04-20-consciousness-toggle-ui.md`。**
