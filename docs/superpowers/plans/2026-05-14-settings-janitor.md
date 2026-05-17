# Settings 控制中心 + Janitor 维护模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 SettingsPage 改为带左导航的 4-tab 控制中心，新建 Janitor 维护模块（Brain API + DB + Docker 清理 job），打通完整 E2E。

**Architecture:** Brain 侧新增 `janitor.js` + `janitor-jobs/docker-prune.js`，DB 增 `janitor_runs`/`janitor_config` 两表，Brain API 4 端点；前端 SettingsPage 改为 React Router nested layout（4 个 sub-page），MaintenanceTab 轮询 `/api/brain/janitor/*`。

**Tech Stack:** Node.js/Express, PostgreSQL, React 18/TypeScript/TailwindCSS, Playwright CLI

---

## 文件清单

### Brain（新建）
- `packages/brain/migrations/271_janitor.sql` — 建表
- `packages/brain/src/janitor.js` — job 注册 + 调度 + API handler
- `packages/brain/src/janitor-jobs/docker-prune.js` — Docker 清理 job
- `packages/brain/src/routes/janitor.js` — Express 路由
- `packages/brain/scripts/smoke/janitor-smoke.sh` — 真环境 E2E 验证

### Brain（修改）
- `packages/brain/server.js` — 注册 janitor 路由（+2行）
- `scripts/brain-build.sh` — 末尾加 docker-prune 触发（+3行）

### Dashboard（新建）
- `apps/dashboard/src/pages/settings/SettingsLayout.tsx` — 左导航容器
- `apps/dashboard/src/pages/settings/BrainSystemTab.tsx` — 现有两个 toggle 迁入
- `apps/dashboard/src/pages/settings/MaintenanceTab.tsx` — Janitor E2E 页面
- `apps/dashboard/src/pages/settings/NotificationsTab.tsx` — stub
- `apps/dashboard/src/pages/settings/AccountsTab.tsx` — stub

### Dashboard（修改）
- `apps/dashboard/src/pages/settings/SettingsPage.tsx` — 重构为重定向到 /settings/brain
- `apps/dashboard/src/App.tsx` — 注册 nested routes

### 测试
- `packages/brain/src/__tests__/janitor.test.js` — unit + integration

---

## Task 1: 写失败的 smoke test（TDD 起点）

**Files:**
- Create: `packages/brain/scripts/smoke/janitor-smoke.sh`

- [ ] **Step 1: 创建 smoke 脚本（此时 API 不存在，必须失败）**

```bash
#!/usr/bin/env bash
# janitor-smoke.sh — Janitor E2E 验证
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
echo "[janitor-smoke] 开始验证..."

# 1. GET /jobs 必须返回 200
echo "[janitor-smoke] 检查 GET /jobs..."
RESP=$(curl -sf "${BRAIN_URL}/api/brain/janitor/jobs" 2>&1) || {
  echo "[janitor-smoke] FAIL: GET /jobs 无响应"
  exit 1
}
echo "$RESP" | grep -q '"jobs"' || { echo "[janitor-smoke] FAIL: 返回缺少 jobs 字段"; exit 1; }

# 2. POST /jobs/docker-prune/run 必须返回 200
echo "[janitor-smoke] 触发 docker-prune..."
RUN_RESP=$(curl -sf -X POST "${BRAIN_URL}/api/brain/janitor/jobs/docker-prune/run" 2>&1) || {
  echo "[janitor-smoke] FAIL: POST /run 无响应"
  exit 1
}
echo "$RUN_RESP" | grep -q '"run_id"' || { echo "[janitor-smoke] FAIL: 返回缺少 run_id"; exit 1; }

# 3. 等待执行完成，GET /jobs 应有 last_run
sleep 3
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/janitor/jobs" | grep -o '"last_status":"[^"]*"' | head -1)
echo "[janitor-smoke] last_status: $STATUS"
echo "$STATUS" | grep -qE '"success"|"failed"' || { echo "[janitor-smoke] FAIL: 未见执行结果"; exit 1; }

echo "[janitor-smoke] PASS"
```

- [ ] **Step 2: 给脚本加可执行权限**

```bash
chmod +x packages/brain/scripts/smoke/janitor-smoke.sh
```

- [ ] **Step 3: 运行脚本，确认它失败（API 还不存在）**

```bash
bash packages/brain/scripts/smoke/janitor-smoke.sh
# 预期: [janitor-smoke] FAIL: GET /jobs 无响应
```

- [ ] **Step 4: Commit**

```bash
git add packages/brain/scripts/smoke/janitor-smoke.sh
git commit -m "test(janitor): 添加 failing smoke test — E2E 起点"
```

---

## Task 2: DB Migration

**Files:**
- Create: `packages/brain/migrations/271_janitor.sql`

- [ ] **Step 1: 写 migration SQL**

```sql
-- 271_janitor.sql: Janitor 维护任务 DB 支持
CREATE TABLE IF NOT EXISTS janitor_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      TEXT NOT NULL,
  job_name    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running','success','failed','skipped')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  output      TEXT,
  freed_bytes BIGINT
);

CREATE INDEX IF NOT EXISTS janitor_runs_job_id_started_at
  ON janitor_runs (job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS janitor_config (
  job_id     TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  schedule   TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 初始化 docker-prune job 配置
INSERT INTO janitor_config (job_id, enabled, schedule)
VALUES ('docker-prune', true, '0 2 * * *')
ON CONFLICT (job_id) DO NOTHING;
```

- [ ] **Step 2: 验证 migration 文件命名正确（须大于270）**

```bash
ls packages/brain/migrations/ | sort | tail -5
# 应看到 271_janitor.sql 在最后
```

- [ ] **Step 3: 在本机 psql 直接跑验证语法**

```bash
psql -U cecelia -d cecelia -f packages/brain/migrations/271_janitor.sql
# 预期: CREATE TABLE, CREATE INDEX, INSERT 0 1
```

- [ ] **Step 4: 验证两张表已创建**

```bash
psql -U cecelia -d cecelia -c "\dt janitor*"
# 预期: janitor_config, janitor_runs 两行
```

- [ ] **Step 5: Commit**

```bash
git add packages/brain/migrations/271_janitor.sql
git commit -m "feat(janitor): DB migration 271 — janitor_runs + janitor_config 表"
```

---

## Task 3: docker-prune Job

**Files:**
- Create: `packages/brain/src/janitor-jobs/docker-prune.js`

- [ ] **Step 1: 写 unit test（先失败）**

新建 `packages/brain/src/__tests__/docker-prune.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

describe('docker-prune job', () => {
  beforeEach(() => vi.clearAllMocks());

  it('run() 调用 docker image prune -f', async () => {
    execSync.mockReturnValue(Buffer.from('Total reclaimed space: 1.2GB'));
    const { run } = await import('../janitor-jobs/docker-prune.js');
    const result = await run();
    expect(execSync).toHaveBeenCalledWith(
      'docker image prune -f',
      expect.objectContaining({ encoding: 'utf8' })
    );
    expect(result.status).toBe('success');
  });

  it('run() 解析释放空间字节数', async () => {
    execSync.mockReturnValue('Total reclaimed space: 500MB');
    const { run } = await import('../janitor-jobs/docker-prune.js');
    const result = await run();
    expect(result.freed_bytes).toBeGreaterThan(0);
  });

  it('run() docker 不可用时返回 skipped', async () => {
    execSync.mockImplementation(() => { throw new Error('docker: command not found'); });
    const { run } = await import('../janitor-jobs/docker-prune.js');
    const result = await run();
    expect(result.status).toBe('skipped');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/brain && npx vitest run src/__tests__/docker-prune.test.js 2>&1 | tail -10
# 预期: Cannot find module '../janitor-jobs/docker-prune.js'
```

- [ ] **Step 3: 实现 docker-prune.js**

```js
// packages/brain/src/janitor-jobs/docker-prune.js
import { execSync } from 'child_process';

export const JOB_ID = 'docker-prune';
export const JOB_NAME = 'Docker 镜像清理';

function parseFreedBytes(output) {
  const match = output.match(/Total reclaimed space:\s*([\d.]+)\s*(B|KB|MB|GB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3 };
  return Math.round(value * (multipliers[unit] ?? 1));
}

export async function run() {
  try {
    const output = execSync('docker image prune -f', {
      encoding: 'utf8',
      timeout: 60000
    });
    execSync('docker container prune -f', { encoding: 'utf8', timeout: 30000 });
    return {
      status: 'success',
      output: output.trim().slice(0, 500),
      freed_bytes: parseFreedBytes(output)
    };
  } catch (err) {
    if (err.message.includes('command not found') || err.message.includes('Cannot connect')) {
      return { status: 'skipped', output: 'Docker 不可用: ' + err.message.slice(0, 100) };
    }
    return { status: 'failed', output: err.message.slice(0, 500) };
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd packages/brain && npx vitest run src/__tests__/docker-prune.test.js
# 预期: 3 tests passed
```

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/janitor-jobs/docker-prune.js \
        packages/brain/src/__tests__/docker-prune.test.js
git commit -m "feat(janitor): docker-prune job + unit tests"
```

---

## Task 4: Janitor 核心模块 + API 路由

**Files:**
- Create: `packages/brain/src/janitor.js`
- Create: `packages/brain/src/routes/janitor.js`

- [ ] **Step 1: 写 integration test（先失败）**

追加到 `packages/brain/src/__tests__/janitor.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../db.js';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));
vi.mock('../janitor-jobs/docker-prune.js', () => ({
  JOB_ID: 'docker-prune',
  JOB_NAME: 'Docker 镜像清理',
  run: vi.fn().mockResolvedValue({ status: 'success', output: 'OK', freed_bytes: 1000 })
}));

describe('janitor module', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getJobs() 返回所有注册 job 的状态', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // janitor_config
    pool.query.mockResolvedValueOnce({ rows: [] }); // last runs
    const { getJobs } = await import('../janitor.js');
    const result = await getJobs(pool);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].id).toBe('docker-prune');
  });

  it('runJob() 写入 janitor_runs 并返回 run_id', async () => {
    const fakeRunId = 'test-uuid-123';
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: fakeRunId, job_id: 'docker-prune' }] }) // INSERT started
      .mockResolvedValueOnce({ rows: [] }); // UPDATE finished
    const { runJob } = await import('../janitor.js');
    const result = await runJob(pool, 'docker-prune');
    expect(result.run_id).toBe(fakeRunId);
    expect(result.status).toBe('success');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/brain && npx vitest run src/__tests__/janitor.test.js 2>&1 | tail -5
# 预期: Cannot find module '../janitor.js'
```

- [ ] **Step 3: 实现 janitor.js**

```js
// packages/brain/src/janitor.js
import * as dockerPrune from './janitor-jobs/docker-prune.js';

const REGISTRY = [dockerPrune];

export async function getJobs(pool) {
  const { rows: configs } = await pool.query(
    'SELECT job_id, enabled FROM janitor_config WHERE job_id = ANY($1)',
    [REGISTRY.map(j => j.JOB_ID)]
  );
  const { rows: lastRuns } = await pool.query(`
    SELECT DISTINCT ON (job_id) job_id, status, started_at, finished_at, freed_bytes
    FROM janitor_runs ORDER BY job_id, started_at DESC
  `);
  const configMap = Object.fromEntries(configs.map(c => [c.job_id, c]));
  const runMap = Object.fromEntries(lastRuns.map(r => [r.job_id, r]));

  return {
    jobs: REGISTRY.map(job => ({
      id: job.JOB_ID,
      name: job.JOB_NAME,
      enabled: configMap[job.JOB_ID]?.enabled ?? true,
      last_run: runMap[job.JOB_ID] ?? null
    }))
  };
}

export async function runJob(pool, jobId) {
  const job = REGISTRY.find(j => j.JOB_ID === jobId);
  if (!job) throw new Error(`Unknown job: ${jobId}`);

  const { rows: [run] } = await pool.query(
    `INSERT INTO janitor_runs (job_id, job_name, status)
     VALUES ($1, $2, 'running') RETURNING id, job_id`,
    [job.JOB_ID, job.JOB_NAME]
  );

  const started = Date.now();
  const result = await job.run();

  await pool.query(
    `UPDATE janitor_runs
     SET status=$1, output=$2, freed_bytes=$3,
         finished_at=NOW(), duration_ms=$4
     WHERE id=$5`,
    [result.status, result.output ?? null, result.freed_bytes ?? null,
     Date.now() - started, run.id]
  );

  return { run_id: run.id, ...result };
}

export async function setJobConfig(pool, jobId, { enabled }) {
  await pool.query(
    `INSERT INTO janitor_config (job_id, enabled, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (job_id) DO UPDATE SET enabled=$2, updated_at=NOW()`,
    [jobId, enabled]
  );
  return { job_id: jobId, enabled };
}

export async function getJobHistory(pool, jobId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, status, started_at, finished_at, duration_ms, output, freed_bytes
     FROM janitor_runs WHERE job_id=$1 ORDER BY started_at DESC LIMIT $2`,
    [jobId, limit]
  );
  return { job_id: jobId, history: rows };
}
```

- [ ] **Step 4: 实现 routes/janitor.js**

```js
// packages/brain/src/routes/janitor.js
import { Router } from 'express';
import { getJobs, runJob, setJobConfig, getJobHistory } from '../janitor.js';

const router = Router();

router.get('/jobs', async (req, res) => {
  try {
    res.json(await getJobs(req.app.locals.pool));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/run', async (req, res) => {
  try {
    const result = await runJob(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.message.startsWith('Unknown') ? 404 : 500)
       .json({ error: err.message });
  }
});

router.patch('/jobs/:id/config', async (req, res) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be boolean' });
    }
    res.json(await setJobConfig(req.app.locals.pool, req.params.id, { enabled }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:id/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '20'), 100);
    res.json(await getJobHistory(req.app.locals.pool, req.params.id, limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
cd packages/brain && npx vitest run src/__tests__/janitor.test.js
# 预期: 3 tests passed
```

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/janitor.js \
        packages/brain/src/routes/janitor.js \
        packages/brain/src/__tests__/janitor.test.js
git commit -m "feat(janitor): janitor.js 核心模块 + API 路由 + tests"
```

---

## Task 5: 注册路由 + brain-build.sh 集成

**Files:**
- Modify: `packages/brain/server.js`
- Modify: `scripts/brain-build.sh`

- [ ] **Step 1: 在 server.js 注册 janitor 路由**

找到文件中 settings 路由注册的位置（约第 223 行）：
```js
import settingsRoutes from './src/routes/settings.js';
app.use('/api/brain/settings', settingsRoutes);
```

在其后紧接着添加：
```js
import janitorRoutes from './src/routes/janitor.js';
app.use('/api/brain/janitor', janitorRoutes);
```

同时确认 `app.locals.pool` 已经设置（在 server.js 中查找 `app.locals.pool = pool` 或类似语句，若无则在 pool 初始化后加一行）：
```js
app.locals.pool = pool;
```

- [ ] **Step 2: 验证路由注册**

```bash
# 重启 brain（本机 node 方式，不用 docker）
node packages/brain/server.js &
sleep 3
curl -s localhost:5221/api/brain/janitor/jobs | python3 -c "import sys,json; d=json.load(sys.stdin); print('jobs:', len(d['jobs']))"
# 预期: jobs: 1
kill %1
```

- [ ] **Step 3: 在 brain-build.sh 末尾加 docker-prune 触发**

找到 `scripts/brain-build.sh` 最后几行：
```bash
echo "  Size: $(docker images "cecelia-brain:${VERSION}" --format '{{.Size}}')"
```

在最后追加：
```bash

# Build 完成后清理 dangling 镜像，防止虚拟磁盘膨胀
echo ""
echo "=== 清理 dangling 镜像 ==="
docker image prune -f --filter "dangling=true" 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add packages/brain/server.js scripts/brain-build.sh
git commit -m "feat(janitor): 注册 API 路由 + brain-build.sh 自动清理"
```

---

## Task 6: Frontend — SettingsPage 改为 nested layout

**Files:**
- Create: `apps/dashboard/src/pages/settings/SettingsLayout.tsx`
- Modify: `apps/dashboard/src/pages/settings/SettingsPage.tsx`
- Modify: `apps/dashboard/src/App.tsx`

- [ ] **Step 1: 创建 SettingsLayout.tsx（左导航容器）**

```tsx
// apps/dashboard/src/pages/settings/SettingsLayout.tsx
import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/settings/brain',         label: 'Brain 系统' },
  { to: '/settings/maintenance',   label: '维护'       },
  { to: '/settings/notifications', label: '通知'       },
  { to: '/settings/accounts',      label: '账户'       },
];

export default function SettingsLayout() {
  return (
    <div className="flex h-full min-h-screen bg-gray-950 text-gray-100">
      <nav className="w-48 shrink-0 border-r border-gray-800 pt-6 px-3">
        <p className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          设置
        </p>
        {NAV_ITEMS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm mb-1 transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 修改 SettingsPage.tsx（改为重定向）**

将现有 SettingsPage.tsx 内容替换为：

```tsx
// apps/dashboard/src/pages/settings/SettingsPage.tsx
import { Navigate } from 'react-router-dom';

export default function SettingsPage() {
  return <Navigate to="/settings/brain" replace />;
}
```

- [ ] **Step 3: 在 App.tsx 注册 nested routes**

在 App.tsx 中找到 `/settings` 的路由定义（通过 DynamicRouter 或静态路由）。在静态路由区（Suspense 包裹的路由块附近）添加：

```tsx
import SettingsLayout from './pages/settings/SettingsLayout';
import BrainSystemTab from './pages/settings/BrainSystemTab';
import MaintenanceTab from './pages/settings/MaintenanceTab';
import NotificationsTab from './pages/settings/NotificationsTab';
import AccountsTab from './pages/settings/AccountsTab';

// 在 <Routes> 内添加（替换原有 /settings 路由）：
<Route path="/settings" element={<SettingsLayout />}>
  <Route index element={<Navigate to="/settings/brain" replace />} />
  <Route path="brain" element={<BrainSystemTab />} />
  <Route path="maintenance" element={<MaintenanceTab />} />
  <Route path="notifications" element={<NotificationsTab />} />
  <Route path="accounts" element={<AccountsTab />} />
</Route>
```

注意：需要先检查 App.tsx 是否有已有的 `/settings` 路由，若有则替换而非新增。

- [ ] **Step 4: 创建 stub 页面**

```tsx
// apps/dashboard/src/pages/settings/NotificationsTab.tsx
export default function NotificationsTab() {
  return (
    <div className="text-gray-400 text-sm">通知设置即将推出</div>
  );
}
```

```tsx
// apps/dashboard/src/pages/settings/AccountsTab.tsx
export default function AccountsTab() {
  return (
    <div className="text-gray-400 text-sm">账户设置即将推出</div>
  );
}
```

- [ ] **Step 5: 截图验证 layout 渲染**

```bash
# 确保 dev server 在跑（Task 5 已验证 Brain，这里看 Dashboard）
playwright screenshot --browser chromium --wait-for-timeout 2000 \
  --viewport-size "1440,900" \
  "http://localhost:5212/settings" \
  /Users/administrator/claude-output/settings-layout.png
```

读取截图确认左导航 4 项可见。

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/pages/settings/SettingsLayout.tsx \
        apps/dashboard/src/pages/settings/SettingsPage.tsx \
        apps/dashboard/src/pages/settings/NotificationsTab.tsx \
        apps/dashboard/src/pages/settings/AccountsTab.tsx \
        apps/dashboard/src/App.tsx
git commit -m "feat(settings): SettingsPage 改为 nested layout，4-tab 结构"
```

---

## Task 7: BrainSystemTab（迁移现有两个 toggle）

**Files:**
- Create: `apps/dashboard/src/pages/settings/BrainSystemTab.tsx`

- [ ] **Step 1: 从 SettingsPage 提取 toggle 逻辑到 BrainSystemTab.tsx**

把原 SettingsPage.tsx 的完整 toggle 实现迁移过来（意识开关 + 飞书静默）：

```tsx
// apps/dashboard/src/pages/settings/BrainSystemTab.tsx
import { useEffect, useState } from 'react';

interface ToggleConfig {
  label: string;
  apiPath: string;
  onDesc: string;
  offDesc: string;
}

const TOGGLES: ToggleConfig[] = [
  {
    label: '意识开关',
    apiPath: '/api/brain/settings/consciousness',
    onDesc: '开 — Brain 会跑情绪 / 反思 / 自驱 / 日记等活动（消耗 LLM token）',
    offDesc: '关 — Brain 不跑意识活动，节省 token',
  },
  {
    label: '飞书静默开关',
    apiPath: '/api/brain/settings/muted',
    onDesc: '开 — Brain 主动消息会发到飞书（告警 / 播报 / 日报）',
    offDesc: '关 — Brain 主动消息静默，不发飞书',
  },
];

function ToggleCard({ config }: { config: ToggleConfig }) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(config.apiPath)
      .then(r => r.json())
      .then(setStatus)
      .catch(e => setError(e.message));
  }, [config.apiPath]);

  const toggle = async () => {
    if (!status || loading) return;
    setLoading(true);
    try {
      const enabled = !(status.enabled ?? status.consciousness_enabled ?? status.muted);
      const r = await fetch(config.apiPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setStatus(await r.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const isOn = status?.enabled ?? status?.consciousness_enabled ?? !status?.muted;
  const lastChanged = status?.last_changed_at ?? status?.changed_at;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 mb-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-200">{config.label}</p>
          <p className="text-xs text-gray-400 mt-1">
            {isOn ? config.onDesc : config.offDesc}
          </p>
          {lastChanged && (
            <p className="text-xs text-gray-600 mt-1">
              上次切换: {new Date(lastChanged).toLocaleString('zh-CN')}
            </p>
          )}
        </div>
        <button
          onClick={toggle}
          disabled={loading || !status}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isOn ? 'bg-emerald-500' : 'bg-gray-600'
          } disabled:opacity-50`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            isOn ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}

export default function BrainSystemTab() {
  return (
    <div className="max-w-lg">
      <h2 className="text-base font-semibold text-gray-200 mb-4">Brain 系统</h2>
      {TOGGLES.map(t => <ToggleCard key={t.apiPath} config={t} />)}
    </div>
  );
}
```

- [ ] **Step 2: 截图验证 Brain 系统 tab**

```bash
playwright screenshot --browser chromium --wait-for-timeout 2500 \
  --viewport-size "1440,900" \
  "http://localhost:5212/settings/brain" \
  /Users/administrator/claude-output/settings-brain-tab.png
```

确认两个 toggle 显示正常。

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/pages/settings/BrainSystemTab.tsx
git commit -m "feat(settings): BrainSystemTab — 迁移现有两个 toggle"
```

---

## Task 8: MaintenanceTab（Janitor E2E 前端）

**Files:**
- Create: `apps/dashboard/src/pages/settings/MaintenanceTab.tsx`

- [ ] **Step 1: 实现 MaintenanceTab.tsx**

```tsx
// apps/dashboard/src/pages/settings/MaintenanceTab.tsx
import { useCallback, useEffect, useState } from 'react';

interface JanitorJob {
  id: string;
  name: string;
  enabled: boolean;
  last_run: {
    status: 'success' | 'failed' | 'skipped' | 'running';
    started_at: string;
    finished_at?: string;
    duration_ms?: number;
    freed_bytes?: number;
  } | null;
}

interface RunHistory {
  id: string;
  status: string;
  started_at: string;
  duration_ms?: number;
  output?: string;
  freed_bytes?: number;
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return null;
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-emerald-500/20 text-emerald-400',
    failed:  'bg-red-500/20 text-red-400',
    skipped: 'bg-gray-500/20 text-gray-400',
    running: 'bg-blue-500/20 text-blue-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] ?? colors.skipped}`}>
      {status}
    </span>
  );
}

function JobCard({ job, onRefresh }: { job: JanitorJob; onRefresh: () => void }) {
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<RunHistory[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const runNow = async () => {
    setRunning(true);
    try {
      await fetch(`/api/brain/janitor/jobs/${job.id}/run`, { method: 'POST' });
      setTimeout(onRefresh, 1500);
    } finally {
      setRunning(false);
    }
  };

  const toggleEnabled = async () => {
    await fetch(`/api/brain/janitor/jobs/${job.id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    onRefresh();
  };

  const loadHistory = async () => {
    if (history) { setShowHistory(v => !v); return; }
    const r = await fetch(`/api/brain/janitor/jobs/${job.id}/history?limit=10`);
    const d = await r.json();
    setHistory(d.history);
    setShowHistory(true);
  };

  const freed = formatBytes(job.last_run?.freed_bytes);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-200">{job.name}</span>
          {job.last_run && <StatusBadge status={job.last_run.status} />}
          {freed && <span className="text-xs text-gray-500">释放 {freed}</span>}
        </div>
        <button
          onClick={toggleEnabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            job.enabled ? 'bg-emerald-500' : 'bg-gray-600'
          }`}
        >
          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            job.enabled ? 'translate-x-5' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {job.last_run && (
        <p className="text-xs text-gray-500 mb-3">
          上次: {new Date(job.last_run.started_at).toLocaleString('zh-CN')}
          {job.last_run.duration_ms && ` · ${job.last_run.duration_ms}ms`}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={runNow}
          disabled={running}
          className="text-xs px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50"
        >
          {running ? '执行中...' : '立即执行'}
        </button>
        <button
          onClick={loadHistory}
          className="text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400"
        >
          历史记录 {showHistory ? '▲' : '▼'}
        </button>
      </div>

      {showHistory && history && (
        <div className="mt-3 border-t border-gray-800 pt-3 space-y-1">
          {history.length === 0 && (
            <p className="text-xs text-gray-500">暂无记录</p>
          )}
          {history.map(run => (
            <div key={run.id} className="flex items-center gap-2 text-xs text-gray-500">
              <StatusBadge status={run.status} />
              <span>{new Date(run.started_at).toLocaleString('zh-CN')}</span>
              {run.freed_bytes && <span>{formatBytes(run.freed_bytes)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MaintenanceTab() {
  const [data, setData] = useState<{ jobs: JanitorJob[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/brain/janitor/jobs')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">加载中...</p>;

  return (
    <div className="max-w-lg">
      <h2 className="text-base font-semibold text-gray-200 mb-4">维护任务</h2>
      {data.jobs.map(job => (
        <JobCard key={job.id} job={job} onRefresh={refresh} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 重新部署 Brain（让新 API 生效）**

```bash
bash scripts/brain-build.sh 2>&1 | tail -5
bash scripts/brain-deploy.sh 2>&1 | tail -5
```

- [ ] **Step 3: 截图验证 MaintenanceTab**

```bash
playwright screenshot --browser chromium --wait-for-timeout 3000 \
  --viewport-size "1440,900" \
  "http://localhost:5212/settings/maintenance" \
  /Users/administrator/claude-output/settings-maintenance.png
```

确认：左导航可见、Docker 清理卡片显示、"立即执行"按钮存在。

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/settings/MaintenanceTab.tsx
git commit -m "feat(settings): MaintenanceTab — Janitor E2E 前端"
```

---

## Task 9: 让 smoke test 通过 + Learning 文档

**Files:**
- Modify: `packages/brain/scripts/smoke/janitor-smoke.sh`（若需要调整）
- Create: `docs/learnings/cp-0514085250-janitor-walking-skeleton.md`

- [ ] **Step 1: 跑 smoke test，应该通过**

```bash
bash packages/brain/scripts/smoke/janitor-smoke.sh
# 预期: [janitor-smoke] PASS
```

若失败，根据错误信息修复并重新运行。

- [ ] **Step 2: 跑全量 unit tests**

```bash
cd packages/brain && npx vitest run src/__tests__/janitor.test.js src/__tests__/docker-prune.test.js
# 预期: all passed
```

- [ ] **Step 3: 写 Learning 文档**

```markdown
# Learning: Settings 控制中心 + Janitor

### 根本原因
系统维护任务长期散落在各模块，没有统一注册/调度/记录机制，导致磁盘爆满无预警、
无法从前端控制任何维护行为。

### 下次预防
- [ ] 新增 Brain 维护类功能必须注册到 janitor.js REGISTRY
- [ ] brain-build.sh 已自动触发 docker-prune，不需要手动清理
- [ ] 新维护 job 只需在 janitor-jobs/ 下新建文件，实现 JOB_ID/JOB_NAME/run()
```

- [ ] **Step 4: 最终截图对比**

```bash
# 截三张图记录最终状态
playwright screenshot --browser chromium --wait-for-timeout 2500 --viewport-size "1440,900" \
  "http://localhost:5212/settings/brain" /Users/administrator/claude-output/final-brain.png
playwright screenshot --browser chromium --wait-for-timeout 2500 --viewport-size "1440,900" \
  "http://localhost:5212/settings/maintenance" /Users/administrator/claude-output/final-maintenance.png
```

- [ ] **Step 5: Commit**

```bash
git add docs/learnings/cp-0514085250-janitor-walking-skeleton.md
git commit -m "docs(learning): janitor walking skeleton 经验记录"
```

---

## Task 10: DEFINITION.md 版本同步 + Push PR

- [ ] **Step 1: 检查 DEFINITION.md schema_version 是否需要更新**

```bash
grep "schema_version" DEFINITION.md | head -3
node packages/engine/scripts/devgate/check-dod-mapping.cjs 2>&1 | tail -5
```

- [ ] **Step 2: 更新 DEFINITION.md schema_version 到 271**

在 DEFINITION.md 中找到 `schema_version` 字段，更新为 `271`。

- [ ] **Step 3: 写 DoD（在 PR 描述或 AGENTS.md）**

```markdown
## DoD

- [x] [ARTIFACT] packages/brain/migrations/271_janitor.sql 存在
  Test: node -e "require('fs').accessSync('packages/brain/migrations/271_janitor.sql')"

- [x] [BEHAVIOR] GET /api/brain/janitor/jobs 返回 jobs 数组
  Test: manual:curl -sf localhost:5221/api/brain/janitor/jobs

- [x] [BEHAVIOR] POST /api/brain/janitor/jobs/docker-prune/run 返回 run_id
  Test: tests/packages/brain/src/__tests__/janitor.test.js

- [x] [BEHAVIOR] SettingsPage /settings/brain 展示两个 toggle
  Test: manual:node -e "require('fs').accessSync('apps/dashboard/src/pages/settings/BrainSystemTab.tsx')"

- [x] [BEHAVIOR] SettingsPage /settings/maintenance 展示 Janitor 任务列表
  Test: manual:node -e "require('fs').accessSync('apps/dashboard/src/pages/settings/MaintenanceTab.tsx')"
```

- [ ] **Step 4: Push 并创建 PR**

```bash
git push -u origin cp-0514085250-janitor-walking-skeleton
gh pr create \
  --title "feat(janitor): Settings 控制中心 + Janitor 维护模块 walking skeleton" \
  --body "$(cat <<'EOF'
## 变更内容
- SettingsPage 改为 4-tab 左导航容器（Brain系统/维护/通知/账户）
- 新建 Janitor 模块（Brain API + janitor_runs/janitor_config DB 表）
- Docker 清理作为第一个 job，E2E 打通
- brain-build.sh 每次 build 后自动触发 docker-prune

## 测试
- Unit: docker-prune.js + janitor.js
- Integration: API 端点 → DB 写入
- Smoke: packages/brain/scripts/smoke/janitor-smoke.sh

## 任务
Brain task: 630ded36-1d82-4015-865f-5d839a4867a8
EOF
)"
```

- [ ] **Step 5: 等待 CI 通过后合并**

```bash
until [[ $(gh pr checks cp-0514085250-janitor-walking-skeleton 2>/dev/null | grep -cE 'pending|in_progress') == 0 ]]; do
  echo "等待 CI... $(date '+%H:%M:%S')"
  sleep 30
done
echo "CI 完成"
gh pr merge cp-0514085250-janitor-walking-skeleton --squash
```
