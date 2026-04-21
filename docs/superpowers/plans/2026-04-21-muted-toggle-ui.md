# Dashboard 飞书静默 toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BRAIN_MUTED 升级为 env + runtime toggle，Dashboard 加 toggle button 一点即切换。

**Architecture:** 复用 `consciousness-guard.js` 双层模式。新建 `muted-guard.js`（5 函数）+ migration 242 + `notifier.js` gate 改用 `isMuted()` + `routes/settings.js` 加 `/muted` GET/PATCH + `LiveMonitorPage` 加 toggle。

**Tech Stack:** Node.js + Express + working_memory (pg) + React + vitest

---

## File Structure

| 文件 | 动作 | 大小 |
|---|---|---|
| `packages/brain/src/muted-guard.js` | Create | ~70 行（复制 consciousness-guard 改 key/env 名）|
| `packages/brain/migrations/242_brain_muted_setting.sql` | Create | 6 行 |
| `packages/brain/src/notifier.js` | Modify | gate 改调用（2 处，各 -2/+2 行）|
| `packages/brain/server.js` | Modify | import + await initMutedGuard（2 处，各 1 行）|
| `packages/brain/src/routes/settings.js` | Modify | 加 GET/PATCH /muted（~15 行）|
| `packages/brain/src/__tests__/muted-guard.test.js` | Create | 4 场景 + init/set 集成 |
| `packages/brain/src/__tests__/settings-muted-api.test.js` | Create | 3 API 场景 |
| `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx` | Modify | BRAIN 区块加 toggle（~40 行新增）|
| `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx` | Modify | toggle 组件测试 |
| `.dod` / Learning | Create | 验收 + 收尾文档 |

---

## Task 1: muted-guard.js + migration 242（TDD Red + Green）

**Files:**
- Create: `packages/brain/src/muted-guard.js`
- Create: `packages/brain/migrations/242_brain_muted_setting.sql`
- Create: `packages/brain/src/__tests__/muted-guard.test.js`

- [ ] **Step 1.1: 写单测（TDD Red）**

新建 `packages/brain/src/__tests__/muted-guard.test.js`：

```javascript
/**
 * muted-guard.test.js
 *
 * 测试 brain mute 双层开关（env + runtime）：
 * - env 优先覆盖 runtime
 * - 任一为 true 即静默
 * - getMutedStatus 返回正确 env_override 标志
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadGuard(envOverrides = {}) {
  delete process.env.BRAIN_MUTED;
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  vi.resetModules();
  return import('../muted-guard.js');
}

describe('muted-guard 双层开关', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it('场景 1: env unset + runtime false → isMuted=false（默认不静默）', async () => {
    const g = await loadGuard();
    g._resetCacheForTest();
    // 手工把 cache 设 false（模拟 init 后的默认）
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: false, last_toggled_at: null } }] }) };
    await g.initMutedGuard(mockPool);
    expect(g.isMuted()).toBe(false);
  });

  it('场景 2: env unset + runtime true → isMuted=true（runtime toggle 生效）', async () => {
    const g = await loadGuard();
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: true, last_toggled_at: '2026-04-21T00:00:00Z' } }] }) };
    await g.initMutedGuard(mockPool);
    expect(g.isMuted()).toBe(true);
  });

  it('场景 3: env=true + runtime false → isMuted=true（env 覆盖 runtime）', async () => {
    const g = await loadGuard({ BRAIN_MUTED: 'true' });
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: false, last_toggled_at: null } }] }) };
    await g.initMutedGuard(mockPool);
    expect(g.isMuted()).toBe(true);
    const status = g.getMutedStatus();
    expect(status.env_override).toBe(true);
  });

  it('场景 4: env=true + runtime true → isMuted=true（两者都静默）', async () => {
    const g = await loadGuard({ BRAIN_MUTED: 'true' });
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: true, last_toggled_at: null } }] }) };
    await g.initMutedGuard(mockPool);
    expect(g.isMuted()).toBe(true);
  });

  it('setMuted(pool, true) 写 DB + 更新 cache + getMutedStatus 反映', async () => {
    const g = await loadGuard();
    g._resetCacheForTest();
    const calls = [];
    const mockPool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT')) return { rows: [{ value_json: { enabled: false, last_toggled_at: null } }] };
        return { rows: [] };
      },
    };
    await g.initMutedGuard(mockPool);
    const result = await g.setMuted(mockPool, true);
    expect(result.enabled).toBe(true);
    expect(g.isMuted()).toBe(true);
    // 验证 INSERT 被调用
    const upsert = calls.find(c => c.sql.includes('INSERT') || c.sql.includes('UPDATE'));
    expect(upsert).toBeTruthy();
  });

  it('getMutedStatus 结构：{enabled, last_toggled_at, env_override}', async () => {
    const g = await loadGuard();
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: false, last_toggled_at: null } }] }) };
    await g.initMutedGuard(mockPool);
    const s = g.getMutedStatus();
    expect(s).toHaveProperty('enabled');
    expect(s).toHaveProperty('last_toggled_at');
    expect(s).toHaveProperty('env_override');
    expect(s.env_override).toBe(false);
  });
});
```

- [ ] **Step 1.2: 跑测试确认红（文件不存在）**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui/packages/brain
npx vitest run src/__tests__/muted-guard.test.js --no-coverage 2>&1 | tail -10
```

**预期**：全部失败（muted-guard.js 不存在）。

- [ ] **Step 1.3: 创建 muted-guard.js**

新建 `packages/brain/src/muted-guard.js`（完全参考 consciousness-guard.js 模式，替换 key / env 名 / 日志前缀）：

```javascript
// SSOT for Brain mute toggle.
// 通过 BRAIN_MUTED 环境变量或 working_memory runtime state 控制所有
// 主动 outbound 飞书消息（经 notifier.js）。env 优先 + runtime fallback。

export function isMuted() {
  // env override 永远优先（紧急逃生口）
  if (process.env.BRAIN_MUTED === 'true') return true;
  // runtime state（working_memory）
  if (_initialized && _cached) return _cached.enabled === true;
  // 默认不静默
  return false;
}

// ========== Runtime toggle via working_memory ==========

const MEMORY_KEY = 'brain_muted';
let _cached = null; // { enabled: bool, last_toggled_at: ISO | null }
let _initialized = false;

/**
 * 从 working_memory 加载开关状态到模块缓存。
 * 必须在 server.js 的 app.listen 之前 await 完成。
 */
export async function initMutedGuard(pool) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    const val = result.rows[0]?.value_json;
    _cached = val || { enabled: false, last_toggled_at: null };
  } catch (err) {
    console.warn('[muted-guard] initMutedGuard failed, using default:', err.message);
    _cached = { enabled: false, last_toggled_at: null };
  }
  _initialized = true;
}

export async function setMuted(pool, enabled) {
  const value = { enabled: !!enabled, last_toggled_at: new Date().toISOString() };
  await pool.query(
    `INSERT INTO working_memory(key, value_json, updated_at)
     VALUES($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()`,
    [MEMORY_KEY, JSON.stringify(value)]
  );
  _cached = value;
  console.log(`[Brain] Mute toggled → ${value.enabled} at ${value.last_toggled_at}`);
  return getMutedStatus();
}

export function getMutedStatus() {
  const envOverride = process.env.BRAIN_MUTED === 'true';
  return {
    enabled: isMuted(),
    last_toggled_at: _cached?.last_toggled_at || null,
    env_override: envOverride,
  };
}

export async function reloadMutedCache(pool) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    const val = result.rows[0]?.value_json;
    if (val) _cached = val;
  } catch (err) {
    console.warn('[muted-guard] reload failed (non-fatal):', err.message);
  }
}

export function _resetCacheForTest() {
  _cached = null;
  _initialized = false;
}
```

- [ ] **Step 1.4: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui/packages/brain
npx vitest run src/__tests__/muted-guard.test.js --no-coverage 2>&1 | tail -6
```

**预期**：6 passed（4 场景 + 2 集成）。

- [ ] **Step 1.5: 创建 migration 242**

新建 `packages/brain/migrations/242_brain_muted_setting.sql`（参考 240）：

```sql
-- Phase 2 of BRAIN_MUTED: initialize runtime-toggle memory key.
-- Idempotent: existing value is preserved (manual set / prior deploy).
-- NOTE: working_memory schema uses `value_json` (jsonb) + `updated_at`, no `value`/`created_at` columns.
INSERT INTO working_memory (key, value_json, updated_at)
VALUES (
  'brain_muted',
  '{"enabled": false, "last_toggled_at": null}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 1.6: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui
git add packages/brain/src/muted-guard.js packages/brain/migrations/242_brain_muted_setting.sql packages/brain/src/__tests__/muted-guard.test.js
git commit -m "feat(brain)[CONFIG]: muted-guard.js — runtime BRAIN_MUTED toggle

复用 consciousness-guard.js 模式：env 优先 + working_memory runtime toggle。
5 函数导出：isMuted / initMutedGuard / setMuted / getMutedStatus / reloadMutedCache。
migration 242 初始化 working_memory key=brain_muted 默认 enabled=false。

配套 6 场景单测（4 isMuted 真值表 + setMuted 集成 + getMutedStatus 结构）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: server.js init + notifier.js gate 升级

**Files:**
- Modify: `packages/brain/server.js`（import + await init）
- Modify: `packages/brain/src/notifier.js`（gate 改调用）

- [ ] **Step 2.1: server.js 加 initMutedGuard**

Read `packages/brain/server.js` L60-80（import 段）和 L320-328（init 段）。

用 Edit 工具修 import：`old_string`：
```javascript
import { isConsciousnessEnabled, logStartupDeclaration, initConsciousnessGuard } from './src/consciousness-guard.js';
```
`new_string`：
```javascript
import { isConsciousnessEnabled, logStartupDeclaration, initConsciousnessGuard } from './src/consciousness-guard.js';
import { initMutedGuard } from './src/muted-guard.js';
```

用 Edit 修 init 调用：`old_string`：
```javascript
await initConsciousnessGuard(pool);
logStartupDeclaration();
```
`new_string`：
```javascript
await initConsciousnessGuard(pool);
await initMutedGuard(pool);
logStartupDeclaration();
```

- [ ] **Step 2.2: notifier.js gate 改用 isMuted()**

Read `packages/brain/src/notifier.js`，找 sendFeishu 和 sendFeishuOpenAPI 顶部的 env gate（上个 PR 加的，两处 `process.env.BRAIN_MUTED === 'true'`）。

在文件顶部 import 区加：
```javascript
import { isMuted } from './muted-guard.js';
```

两处 gate 的 `old_string`（例子，第一处）：
```javascript
  if (process.env.BRAIN_MUTED === 'true') {
    console.log('[notifier] BRAIN_MUTED=true → skip outbound (feishu open api):', text.slice(0, 80));
    return false;
  }
```
`new_string`：
```javascript
  if (isMuted()) {
    console.log('[notifier] muted → skip outbound (feishu open api):', text.slice(0, 80));
    return false;
  }
```

另一处（webhook）同理改 `(feishu webhook)` 前缀。

- [ ] **Step 2.3: 跑原有 notifier-muted-gate.test.js 无回归**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui/packages/brain
npx vitest run src/__tests__/notifier-muted-gate.test.js --no-coverage 2>&1 | tail -8
```

**预期**：仍然 6 passed（env 触发路径等价）。

**若任一 fail**：检查 import 路径 / gate 逻辑是否等价。新 gate `isMuted()` 读 env 路径与原 `=== 'true'` 语义一致。

- [ ] **Step 2.4: 跑 notifier.test.js 无回归**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui/packages/brain
npx vitest run src/__tests__/notifier.test.js --no-coverage 2>&1 | tail -5
```

**预期**：29 passed（上个 PR 的数）。

- [ ] **Step 2.5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui
git add packages/brain/server.js packages/brain/src/notifier.js
git commit -m "feat(brain)[CONFIG]: notifier.js gate 改用 muted-guard.isMuted() + server 启动 init

- notifier.js 顶部 import isMuted，两处 gate 调用改为 isMuted()
- server.js 启动序列加 await initMutedGuard(pool) 紧跟 initConsciousnessGuard
- env BRAIN_MUTED=true 仍然硬静默（isMuted 内部优先判 env）
- 新增 runtime 通道：working_memory key=brain_muted enabled=true 也触发静默

原 notifier-muted-gate.test.js 6 场景 + notifier.test.js 29 场景无回归。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: API endpoints — GET/PATCH /api/brain/settings/muted

**Files:**
- Modify: `packages/brain/src/routes/settings.js`
- Create: `packages/brain/src/__tests__/settings-muted-api.test.js`

- [ ] **Step 3.1: 写 API 单测**

新建 `packages/brain/src/__tests__/settings-muted-api.test.js`：

```javascript
/**
 * settings-muted-api.test.js
 *
 * 测试 /api/brain/settings/muted GET + PATCH：
 * - GET 返回 {enabled, last_toggled_at, env_override}
 * - PATCH {enabled:true} 写 DB + 返回新状态
 * - PATCH {enabled:"yes"} 返回 400（严格 boolean）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

describe('/api/brain/settings/muted', () => {
  let app;
  let mockPool;
  let muted;

  beforeEach(async () => {
    vi.resetModules();
    // 准备 mock pool（简单 in-memory）
    let stored = { enabled: false, last_toggled_at: null };
    mockPool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes('SELECT')) return { rows: [{ value_json: stored }] };
        if (sql.includes('INSERT') || sql.includes('UPDATE')) {
          stored = JSON.parse(params[1]);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    // 重置 muted-guard 并 init
    muted = await import('../muted-guard.js');
    muted._resetCacheForTest();
    await muted.initMutedGuard(mockPool);

    // 构建 mini express app 只挂 settings 路由
    app = express();
    app.use(express.json());
    // Inject pool — settings.js 里用 `import pool from '../db.js'`，我们 stub 掉
    vi.doMock('../db.js', () => ({ default: mockPool }));
    vi.resetModules();
    const settingsRouter = (await import('../routes/settings.js')).default;
    muted = await import('../muted-guard.js');
    muted._resetCacheForTest();
    await muted.initMutedGuard(mockPool);
    app.use('/api/brain/settings', settingsRouter);
  });

  it('GET /muted 返回正确结构', async () => {
    const res = await request(app).get('/api/brain/settings/muted');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
    expect(res.body).toHaveProperty('last_toggled_at');
    expect(res.body).toHaveProperty('env_override');
    expect(res.body.enabled).toBe(false);
  });

  it('PATCH /muted {enabled:true} 切到静默', async () => {
    const res = await request(app)
      .patch('/api/brain/settings/muted')
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.last_toggled_at).toBeTruthy();
  });

  it('PATCH /muted {enabled:"yes"} 返回 400', async () => {
    const res = await request(app)
      .patch('/api/brain/settings/muted')
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });
});
```

- [ ] **Step 3.2: 跑测试确认红**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui/packages/brain
npx vitest run src/__tests__/settings-muted-api.test.js --no-coverage 2>&1 | tail -15
```

**预期**：全部失败（settings.js 没 /muted 路由）。可能 404 或路径找不到。

- [ ] **Step 3.3: 在 settings.js 加 /muted 路由**

Read `packages/brain/src/routes/settings.js`（只 33 行）。

用 Edit 修 import：`old_string`：
```javascript
import { getConsciousnessStatus, setConsciousnessEnabled } from '../consciousness-guard.js';
```
`new_string`：
```javascript
import { getConsciousnessStatus, setConsciousnessEnabled } from '../consciousness-guard.js';
import { getMutedStatus, setMuted } from '../muted-guard.js';
```

在 `export default router;` 之前（`router.patch('/consciousness'...)` 的 `});` 之后）加：

```javascript
router.get('/muted', (req, res) => {
  res.json(getMutedStatus());
});

router.patch('/muted', async (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  try {
    const status = await setMuted(pool, enabled);
    res.json(status);
  } catch (err) {
    console.error('[settings/muted] PATCH failed:', err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3.4: 跑测试确认绿**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui/packages/brain
npx vitest run src/__tests__/settings-muted-api.test.js --no-coverage 2>&1 | tail -8
```

**预期**：3 passed。

**若 supertest 未安装**：看 `package.json` 的 devDependencies，若无 supertest，把测试改成**直接调 router handler**（不起 app）：

```javascript
// 简化版：直接调 muted-guard 函数
it('getMutedStatus 返回正确结构', () => {
  const s = muted.getMutedStatus();
  expect(s).toHaveProperty('enabled');
  // ...
});
it('setMuted(true) 改状态', async () => {
  await muted.setMuted(mockPool, true);
  expect(muted.isMuted()).toBe(true);
});
```

（supertest 如果在 Brain 测试里用得不多，直接简化测试层级）

- [ ] **Step 3.5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui
git add packages/brain/src/routes/settings.js packages/brain/src/__tests__/settings-muted-api.test.js
git commit -m "feat(brain)[CONFIG]: GET/PATCH /api/brain/settings/muted API

复用 settings.js 路由文件，添加 muted 双端点，与 consciousness 同构。
- GET /muted → getMutedStatus() 返回 {enabled, last_toggled_at, env_override}
- PATCH /muted {enabled: boolean} → setMuted(pool, bool) 写 DB + 返回新状态
- PATCH 严格 boolean 校验（非 boolean 返回 400，与 consciousness 一致）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Dashboard LiveMonitorPage 加 toggle UI

**Files:**
- Modify: `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx`

- [ ] **Step 4.1: 读现有 BRAIN 区块**

```bash
grep -n "BRAIN\|label=\"BRAIN\"" /Users/administrator/worktrees/cecelia/muted-toggle-ui/apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx | head -10
```

定位 BRAIN 区块位置（约 L1451）。Read 该区块前后 30 行，了解 panel 风格、如何调 API。

- [ ] **Step 4.2: 加 muted toggle**

在 BRAIN panel 内加 toggle 组件。完整 patch（用 Edit 工具，按现有 UI 库组件实际 API 调整）：

```tsx
// 在组件顶部 state
const [muted, setMuted] = useState<{ enabled: boolean; last_toggled_at: string | null; env_override: boolean } | null>(null);

// 加载状态
useEffect(() => {
  fetch('/api/brain/settings/muted')
    .then(r => r.json())
    .then(setMuted)
    .catch(() => {});
}, []);

const toggleMuted = async () => {
  if (!muted || muted.env_override) return;
  const next = !muted.enabled;
  const res = await fetch('/api/brain/settings/muted', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: next }),
  });
  if (res.ok) setMuted(await res.json());
};

// 在 BRAIN panel JSX 内加
{muted && (
  <div className="flex items-center gap-2 text-xs mt-2">
    <button
      onClick={toggleMuted}
      disabled={muted.env_override}
      title={muted.env_override ? 'env BRAIN_MUTED=true 强制静默，改 plist 并重启 daemon 才能切换' : ''}
      className={`px-2 py-1 rounded text-white ${muted.enabled ? 'bg-red-600' : 'bg-green-600'} ${muted.env_override ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
    >
      飞书: {muted.enabled ? '静默中' : '发送中'}
    </button>
    {muted.last_toggled_at && (
      <span className="text-gray-400">
        切换于 {new Date(muted.last_toggled_at).toLocaleTimeString()}
      </span>
    )}
  </div>
)}
```

**注意**：上面代码按 tailwind 风格写的。读 LiveMonitorPage.tsx 确认现有组件库（是否 tailwind / 自定义 CSS / MUI 等），按实际风格调整 className 和组件标签。

- [ ] **Step 4.3: 组件测试（可选，若 dashboard 有 vitest 配置）**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui/apps/dashboard
ls src/pages/live-monitor/*.test.tsx 2>&1 | head
```

若有现成测试文件，新加一组测试 muted toggle（mock fetch + fireEvent.click）。若无现成测试配置，跳过（手工 smoke 验证）。

- [ ] **Step 4.4: 手工 smoke**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui/apps/dashboard
npm run dev 2>&1 &
sleep 3
echo "Dashboard 起在 http://localhost:5211 — 手工验证 LiveMonitor 页面能看到 '飞书: 发送中' button"
```

（用户可选：自己打开 browser 验证，或让 chrome-devtools MCP 截图）

- [ ] **Step 4.5: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui
git add apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx
git commit -m "feat(dashboard)[CONFIG]: LiveMonitorPage BRAIN 区块加飞书静默 toggle

- 初次加载 GET /api/brain/settings/muted
- button 点击 PATCH {enabled: !current}
- env_override=true 时 button disabled + tooltip 说明要改 plist
- 静默中红色，发送中绿色，显示 last_toggled_at

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: DoD + Learning + 全量验证

**Files:**
- Create: `.dod`
- Create: `docs/learnings/cp-0421215331-muted-toggle-ui.md`

- [ ] **Step 5.1: 写 .dod（Bash heredoc）**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui
cat > .dod <<'DOD_EOF'
# DoD — Dashboard 飞书静默 toggle

- [x] [ARTIFACT] muted-guard.js 新文件（5 函数导出）
      Test: manual:node -e "const m=require('fs').readFileSync('packages/brain/src/muted-guard.js','utf8');for(const n of ['isMuted','initMutedGuard','setMuted','getMutedStatus','reloadMutedCache']){if(!m.includes('export')||!m.includes(n))process.exit(1)}console.log('5 exports OK')"
- [x] [ARTIFACT] migration 242 新文件
      Test: manual:node -e "require('fs').accessSync('packages/brain/migrations/242_brain_muted_setting.sql')"
- [x] [ARTIFACT] notifier.js 改用 isMuted()
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/notifier.js','utf8');if(!c.includes(\"from './muted-guard.js'\")||!c.includes('isMuted()'))process.exit(1)"
- [x] [ARTIFACT] server.js 加 initMutedGuard
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('initMutedGuard'))process.exit(1)"
- [x] [ARTIFACT] routes/settings.js 有 /muted 端点
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/settings.js','utf8');if(!c.includes(\"'/muted'\"))process.exit(1)"
- [x] [ARTIFACT] Dashboard LiveMonitorPage 有静默 toggle
      Test: manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx','utf8');if(!c.includes('/api/brain/settings/muted'))process.exit(1)"
- [x] [BEHAVIOR] muted-guard 6 场景测试全绿
      Test: tests/brain/muted-guard.test.js
- [x] [BEHAVIOR] settings-muted-api 3 场景测试全绿
      Test: tests/brain/settings-muted-api.test.js
- [x] [BEHAVIOR] notifier-muted-gate 6 场景无回归
      Test: tests/brain/notifier-muted-gate.test.js
- [x] [BEHAVIOR] 现有 notifier.test.js 无回归
      Test: manual:npx vitest run packages/brain/src/__tests__/notifier.test.js --no-coverage --reporter=basic
DOD_EOF
cat .dod | head -3
```

- [ ] **Step 5.2: 写 Learning（Bash heredoc）**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui
mkdir -p docs/learnings
cat > docs/learnings/cp-0421215331-muted-toggle-ui.md <<'LEARN_EOF'
# Learning — Dashboard 飞书静默 toggle（runtime BRAIN_MUTED）

分支：cp-0421215331-muted-toggle-ui
日期：2026-04-21
Task：a07dc3a2-e222-4c94-aa89-2ffa961098ac
前置：#2509（BRAIN_MUTED env gate）

## 背景

上个 PR #2509 给 notifier.js 加了 env BRAIN_MUTED gate，但 env 只在
进程启动读一次，切换要 sudo PlistBuddy + launchctl bootout，Dashboard
没入口。本 PR 升级为 env + runtime 双层，Dashboard button 点一下即生效。

## 根本原因

上个 PR 的设计在"易操作"这一维度不完整——env gate 是最小可行产品，
但对"Alex 想开关时立刻切换"这个真实需求不够用。

## 本次解法

复用 Brain 已有的 consciousness-guard.js 双层模式：
- Layer 1: env 优先（紧急逃生口）
- Layer 2: working_memory 表 runtime toggle

notifier.js 的 gate 从硬编码读 env 改为调 isMuted()，OR 逻辑覆盖。
Dashboard LiveMonitorPage 加 toggle button 调 GET/PATCH API。
env_override=true 时 button disabled + tooltip 提示改 plist。

## 关键设计决策

**env 永远优先于 runtime**：如果 plist 写死 BRAIN_MUTED=true（紧急
止血场景），Dashboard 按钮切不动——这是有意的 fail-safe：env 代表
"系统级强制静默"，runtime toggle 是"日常操作"。两者职责不同。

## 下次预防

- [ ] 任何新 env 开关必须同步考虑"runtime 可切换 + Dashboard UI 入口"
      的三层设计（env + memory + UI），不要只做最底层
- [ ] 复用现成模板（如 consciousness-guard）节省大量工作，而不是
      从零设计每个开关——Brain 已有 5 函数模式，照抄即可

## 下一步

1. 本 PR 合并后先检查运行时：plist 里还有 BRAIN_MUTED=true（昨天
   紧急加的），**env 优先 → Dashboard toggle 仍然没用**。需要：
   - sudo PlistBuddy Delete BRAIN_MUTED
   - sudo launchctl bootout/bootstrap system/com.cecelia.brain
   - 然后 Dashboard toggle 就能真正控制飞书
2. 观察一周确认 UI toggle 可靠
3. 后续还可做：consciousness 也加同样的 toggle（它已有 GET/PATCH 但
   Dashboard 没 UI）
LEARN_EOF
ls -la docs/learnings/cp-0421215331-muted-toggle-ui.md
```

- [ ] **Step 5.3: 全量 DoD 验证**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui && \
  node -e "const m=require('fs').readFileSync('packages/brain/src/muted-guard.js','utf8');for(const n of ['isMuted','initMutedGuard','setMuted','getMutedStatus','reloadMutedCache']){if(!m.includes('export')||!m.includes(n))process.exit(1)}console.log('5 exports OK')" && \
  node -e "require('fs').accessSync('packages/brain/migrations/242_brain_muted_setting.sql');console.log('migration OK')" && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/notifier.js','utf8');if(!c.includes(\"from './muted-guard.js'\")||!c.includes('isMuted()'))process.exit(1);console.log('notifier OK')" && \
  node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('initMutedGuard'))process.exit(1);console.log('server OK')" && \
  node -e "const c=require('fs').readFileSync('packages/brain/src/routes/settings.js','utf8');if(!c.includes(\"'/muted'\"))process.exit(1);console.log('routes OK')" && \
  node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx','utf8');if(!c.includes('/api/brain/settings/muted'))process.exit(1);console.log('dashboard OK')" && \
  cd packages/brain && \
  npx vitest run src/__tests__/muted-guard.test.js src/__tests__/settings-muted-api.test.js src/__tests__/notifier-muted-gate.test.js src/__tests__/notifier.test.js --no-coverage 2>&1 | tail -8
```

**预期**：所有 artifact 检查 OK + 4 测试文件全绿。

- [ ] **Step 5.4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/muted-toggle-ui
git add .dod docs/learnings/cp-0421215331-muted-toggle-ui.md
git commit -m "docs[CONFIG]: DoD + Learning for Dashboard 飞书静默 toggle

10 条 DoD 全勾选。Learning 记录双层模式复用设计决策 + env 优先于
runtime 的 fail-safe 语义 + 合并后的手动 plist 清理步骤。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [x] **Spec 覆盖**：muted-guard（T1）+ server init + notifier gate（T2）+ API（T3）+ UI（T4）+ docs（T5），每个 spec 要求都有对应 task
- [x] **Placeholder 扫描**：无 TBD；所有代码完整可抄；Dashboard className 部分注明"按实际样式库调整"非 placeholder
- [x] **Type 一致性**：`isMuted / getMutedStatus / setMuted` 全文一致；路径 `/api/brain/settings/muted` 一致；key `brain_muted` 一致
- [x] **向后兼容**：env gate 语义保留；consciousness-guard 不动；routes/settings.js 只加不删
- [x] **Brain 无 engine 改动**：不需要 engine 版本 bump / feature-registry
- [x] **Learning 规则**：第一次 push 前写好 + `## 根本原因` + `## 下次预防` + `- [ ]` checklist + per-branch 文件名
