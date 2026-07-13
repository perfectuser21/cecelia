# strategist 容器零落库 + completed↔queued 振荡修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 docker 任务容器访问不到宿主 Brain API 导致的零落库，以及 monitor 把 completed 任务打回 queued 的振荡。

**Architecture:** 防御纵深四刀——① actions.updateTask 转 queued 加终态守卫 ② monitor handleStuckRun 终态调和 ③ executor docker env 默认 host.docker.internal ④ runner 镜像 socat 回环转发通治硬编码 localhost。

**Tech Stack:** Node.js (ESM), vitest, Docker, socat, bash。

## Global Constraints

- 所有输出简体中文；TDD：每个 task commit-1 = failing test，commit-2 = 实现
- 禁止跑 brain 全量 vitest（环境级 OOM）——只跑本任务涉及的测试文件
- spec 见 `docs/superpowers/specs/2026-07-12-strategist-container-zerowrite-oscillation-design.md`

---

### Task 1: actions.updateTask 终态守卫（Bug2 铁闸）

**Files:**
- Modify: `packages/brain/src/actions.js:333-385`（updateTask）
- Test: `packages/brain/src/__tests__/actions.test.js`（updateTask describe 块内追加）

**Interfaces:**
- Produces: `updateTask({task_id, status:'queued'})` 在任务当前 status ∈ (completed, cancelled) 时返回 `{success:false, error:'Task not found or in terminal state (completed/cancelled cannot be requeued)'}`，SQL WHERE 含 `status NOT IN ('completed', 'cancelled')`。

- [ ] **Step 1: Write the failing tests**（actions.test.js 的 `queued 状态同时清除 claimed_by 和 claimed_at` 测试后追加）

```js
    it('转 queued 时 WHERE 带终态守卫（completed/cancelled 不可被打回）', async () => {
      const fakeTask = { id: 'task-requeue2', status: 'queued' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await updateTask({ task_id: 'task-requeue2', status: 'queued' });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain(`status NOT IN ('completed', 'cancelled')`);
    });

    it('completed 任务转 queued 被拒（0 行命中返回 error）', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await updateTask({ task_id: 'task-done', status: 'queued' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/terminal state/);
    });

    it('转 in_progress / completed 不受终态守卫影响', async () => {
      const fakeTask = { id: 'task-c', status: 'completed' };
      mockQuery.mockResolvedValueOnce({ rows: [fakeTask] });

      await updateTask({ task_id: 'task-c', status: 'completed' });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).not.toContain(`status NOT IN`);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/actions.test.js -t "终态守卫" 2>&1 | tail -20`
Expected: FAIL（SQL 不含 status NOT IN）

- [ ] **Step 3: Commit failing test**

```bash
git add packages/brain/src/__tests__/actions.test.js
git commit -m "test: updateTask 转 queued 终态守卫 failing test（bug2 振荡回归）"
```

- [ ] **Step 4: Implement**（actions.js updateTask 内）

把：

```js
  const whereClause = status === 'in_progress'
    ? `id = $${idx} AND status = 'queued'`
    : `id = $${idx}`;
```

改成：

```js
  // Atomic guards:
  // - in_progress: only from queued (prevents double-dispatch race)
  // - queued: never from terminal states (completed/cancelled) — monitor/retry
  //   callers must not resurrect finished tasks (issue 219a9efc oscillation);
  //   explicit manual psql bypasses this by design
  let whereClause = `id = $${idx}`;
  if (status === 'in_progress') {
    whereClause += ` AND status = 'queued'`;
  } else if (status === 'queued') {
    whereClause += ` AND status NOT IN ('completed', 'cancelled')`;
  }
```

并把 0 行返回的 error 分支改成：

```js
  if (result.rows.length === 0) {
    const error = status === 'in_progress'
      ? 'Task not found or already dispatched'
      : (status === 'queued'
          ? 'Task not found or in terminal state (completed/cancelled cannot be requeued)'
          : 'Task not found');
    return { success: false, error };
  }
```

- [ ] **Step 5: Run tests to verify pass（含旧测试不回归）**

Run: `cd packages/brain && npx vitest run src/__tests__/actions.test.js 2>&1 | tail -10`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/actions.js
git commit -m "fix(brain): updateTask 转 queued 加终态守卫——completed/cancelled 不可被程序化打回"
```

---

### Task 2: monitor handleStuckRun 终态调和（Bug2 根位）

**Files:**
- Modify: `packages/brain/src/monitor-loop.js:163-175`（handleStuckRun 开头）
- Test: `packages/brain/src/__tests__/monitor-stuck-terminal.test.js`（新建）

**Interfaces:**
- Consumes: `pool.query`（mock）、`updateTask`（mock）
- Produces: `handleStuckRun` 具名导出（`export { detectFailureSpike }` 处追加）；终态任务 → 关闭 run_events（reason_code='MONITOR_STALE_RUN_RECONCILED'）且不调 updateTask。

- [ ] **Step 1: Write the failing test**（新文件，mock 结构照抄 monitor-loop.test.js 头部）

```js
/**
 * monitor-stuck-terminal.test.js — bug2 回归：completed 任务不可被 stuck 处置打回 queued
 * 实证：issue 219a9efc / _ghost_audit record4 / run 1181b7f7 (MONITOR_RESTART 08:10:14)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const mockUpdateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ updateTask: mockUpdateTask }));

vi.mock('../rca-deduplication.js', () => ({
  shouldAnalyzeFailure: vi.fn(),
  cacheRcaResult: vi.fn(),
  getRcaCacheStats: vi.fn(),
  generateErrorSignature: vi.fn().mockReturnValue('sig'),
}));
vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: vi.fn(),
  dispatchToDevSkill: vi.fn(),
  getAutoFixStats: vi.fn(),
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: vi.fn() }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: vi.fn(), MAX_SEATS: 10 }));
vi.mock('../quarantine.js', () => ({ quarantineTask: vi.fn() }));
vi.mock('../cortex.js', () => ({ performRCA: vi.fn() }));

const { handleStuckRun } = await import('../monitor-loop.js');

const STUCK = {
  run_id: 'run-1',
  task_id: 'task-1',
  minutes_since_heartbeat: '6.0',
};

describe('handleStuckRun 终态调和', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockUpdateTask.mockReset();
  });

  it('completed 任务：不 requeue，关闭 stale run 为 reconciled', async () => {
    // 第一问：retry_count + status
    mockPool.query.mockResolvedValueOnce({ rows: [{ retry_count: 0, status: 'completed' }] });
    // 后续 UPDATE run_events
    mockPool.query.mockResolvedValue({ rows: [] });

    await handleStuckRun(STUCK);

    expect(mockUpdateTask).not.toHaveBeenCalled();
    const runClose = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('MONITOR_STALE_RUN_RECONCILED')
    );
    expect(runClose).toBeTruthy();
  });

  it('cancelled/failed 任务同样不 requeue', async () => {
    for (const s of ['cancelled', 'failed']) {
      mockPool.query.mockReset();
      mockUpdateTask.mockReset();
      mockPool.query.mockResolvedValueOnce({ rows: [{ retry_count: 0, status: s }] });
      mockPool.query.mockResolvedValue({ rows: [] });

      await handleStuckRun(STUCK);
      expect(mockUpdateTask).not.toHaveBeenCalled();
    }
  });

  it('in_progress 任务保持原重启行为（1st stuck → requeue）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ retry_count: 0, status: 'in_progress' }] });
    // task_type 查询（非 harness）
    mockPool.query.mockResolvedValueOnce({ rows: [{ task_type: 'strategist_decision', payload: {} }] });
    mockPool.query.mockResolvedValue({ rows: [] });
    mockUpdateTask.mockResolvedValue({ success: true });

    await handleStuckRun(STUCK);

    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: 'task-1', status: 'queued' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/monitor-stuck-terminal.test.js 2>&1 | tail -15`
Expected: FAIL（handleStuckRun 未导出 / completed 仍被 requeue）

- [ ] **Step 3: Commit failing test**

```bash
git add packages/brain/src/__tests__/monitor-stuck-terminal.test.js
git commit -m "test: handleStuckRun 终态任务不 requeue failing test（bug2 根位回归）"
```

- [ ] **Step 4: Implement**（monitor-loop.js）

4a. `handleStuckRun` 开头的 taskQuery 改为同时取 status，终态短路：

```js
  // Get task retry count + status
  const taskQuery = await pool.query(
    'SELECT retry_count, status FROM tasks WHERE id = $1',
    [stuck.task_id]
  );

  if (taskQuery.rows.length === 0) {
    console.log(`[Monitor] Task ${stuck.task_id} not found, skipping`);
    return;
  }

  // 终态调和（issue 219a9efc）：任务已终态但 run_events 没关（callback 路径漏关）
  // → 只关闭 stale run，绝不 requeue。completed 任务被打回 queued 会造成
  // completed↔queued 振荡 + 同任务重复执行。
  const taskStatus = taskQuery.rows[0].status;
  if (['completed', 'cancelled', 'failed'].includes(taskStatus)) {
    console.log(
      `[Monitor] Task ${stuck.task_id} already terminal (${taskStatus}), ` +
      `closing stale run ${stuck.run_id} as reconciled instead of restarting`
    );
    await pool.query(
      `UPDATE run_events
       SET status = $2,
           ts_end = NOW(),
           reason_code = 'MONITOR_STALE_RUN_RECONCILED',
           reason_kind = 'RECONCILED'
       WHERE run_id = $1 AND status = 'running'`,
      [stuck.run_id, taskStatus === 'completed' ? 'completed' : 'failed']
    );
    return;
  }

  const retryCount = taskQuery.rows[0].retry_count || 0;
```

4b. 文件末尾导出追加（`export { detectFailureSpike };` 行改为）：

```js
export { detectFailureSpike, handleStuckRun };
```

（原 116 行的 `export { detectFailureSpike };` 保留位置不动也可，另起一行 `export { handleStuckRun };` 在函数定义之后。）

- [ ] **Step 5: Run tests to verify pass（含 monitor-loop 旧测试）**

Run: `cd packages/brain && npx vitest run src/__tests__/monitor-stuck-terminal.test.js src/__tests__/monitor-loop.test.js src/__tests__/monitor-loop-p2.test.js 2>&1 | tail -10`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/monitor-loop.js
git commit -m "fix(brain): handleStuckRun 终态任务只调和 stale run 不 requeue（issue 219a9efc 振荡根修）"
```

---

### Task 3: executor docker env 默认 host.docker.internal（Bug1 注入层）

**Files:**
- Modify: `packages/brain/src/docker-executor.js`（新增导出 `resolveBrainBaseUrl`）
- Modify: `packages/brain/src/executor.js:3455-3462`（dockerEnv）
- Test: `packages/brain/src/__tests__/docker-brain-url.test.js`（新建）

**Interfaces:**
- Produces: `resolveBrainBaseUrl(env = process.env)` → `env.BRAIN_URL || 'http://host.docker.internal:5221'`。executor docker 分支的 `WEBHOOK_URL`/`CECELIA_CORE_API`/`BRAIN_URL` 全部基于它。

- [ ] **Step 1: Write the failing test**

```js
/**
 * docker-brain-url.test.js — bug1 回归：docker 容器 env 不得默认 localhost:5221
 * bridge 网络容器内 localhost 是容器自己（实测 curl 000），必须 host.docker.internal
 * （--add-host host.docker.internal:host-gateway 已由 docker-executor 注入）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { resolveBrainBaseUrl } from '../docker-executor.js';

describe('resolveBrainBaseUrl', () => {
  it('BRAIN_URL 未设置时默认 host.docker.internal:5221（不是 localhost）', () => {
    expect(resolveBrainBaseUrl({})).toBe('http://host.docker.internal:5221');
  });

  it('BRAIN_URL 显式设置时尊重覆盖', () => {
    expect(resolveBrainBaseUrl({ BRAIN_URL: 'http://10.0.0.5:5221' })).toBe('http://10.0.0.5:5221');
  });
});

describe('executor docker 分支不再硬编码 localhost 默认值', () => {
  it('dockerEnv 构造使用 resolveBrainBaseUrl', () => {
    const src = readFileSync(path.join(__dirname, '../executor.js'), 'utf8');
    // docker 分支（HARNESS_DOCKER_ENABLED）里不允许再出现 localhost:5221 兜底
    const dockerBranch = src.slice(src.indexOf(`HARNESS_DOCKER_ENABLED === 'true'`));
    const dockerEnvBlock = dockerBranch.slice(0, dockerBranch.indexOf('spawnDocker'));
    expect(dockerEnvBlock).toContain('resolveBrainBaseUrl');
    expect(dockerEnvBlock).not.toContain(`'http://localhost:5221'`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/docker-brain-url.test.js 2>&1 | tail -15`
Expected: FAIL（resolveBrainBaseUrl 未定义）

- [ ] **Step 3: Commit failing test**

```bash
git add packages/brain/src/__tests__/docker-brain-url.test.js
git commit -m "test: docker env 默认 host.docker.internal failing test（bug1 零落库回归）"
```

- [ ] **Step 4: Implement**

4a. docker-executor.js（`export async function writeDockerCallback` 之前）加：

```js
/**
 * 容器视角的 Brain API base URL。
 * bridge 网络容器内 localhost 指向容器自己（issue 219a9efc：strategist 零落库根因），
 * 默认必须走 host.docker.internal（spawn 参数已带 --add-host host.docker.internal:host-gateway）。
 * BRAIN_URL 显式设置时尊重覆盖（远端部署等场景）。
 */
export function resolveBrainBaseUrl(env = process.env) {
  return env.BRAIN_URL || 'http://host.docker.internal:5221';
}
```

4b. executor.js 顶部 import 行（第 35 行）追加：

```js
import { writeDockerCallback, resolveResourceTier, isDockerAvailable, resolveBrainBaseUrl } from './docker-executor.js';
```

4c. executor.js dockerEnv 块改为：

```js
      // 注入 webhook + 上下文（与 cecelia-run 行为对齐）
      // bridge 容器内 localhost:5221 不可达（issue 219a9efc），base 默认 host.docker.internal
      const brainBase = resolveBrainBaseUrl();
      const dockerEnv = {
        ...extraEnv,
        WEBHOOK_URL: `${brainBase}/api/brain/execution-callback`,
        CECELIA_CORE_API: brainBase,
        BRAIN_URL: brainBase,
        CECELIA_PERMISSION_MODE: permissionMode,
        CECELIA_TASK_TYPE: taskType,
      };
```

- [ ] **Step 5: Run test to verify pass**

Run: `cd packages/brain && npx vitest run src/__tests__/docker-brain-url.test.js 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/docker-executor.js packages/brain/src/executor.js
git commit -m "fix(brain): docker 容器 env 默认 host.docker.internal:5221——bridge 内 localhost 不可达（issue 219a9efc）"
```

---

### Task 4: runner 镜像 socat 回环转发（Bug1 通治层）

**Files:**
- Modify: `docker/cecelia-runner/Dockerfile`（apt 列表加 socat）
- Modify: `docker/cecelia-runner/entrypoint.sh`（claude 启动前起转发）
- Test: `packages/brain/src/__tests__/runner-loopback-forward.test.js`（新建，文件内容守卫）

**Interfaces:**
- Produces: 容器内 `127.0.0.1:5221` 转发到 `host.docker.internal:5221`，所有硬编码 `localhost:5221` 的 skill curl 直接可用。

- [ ] **Step 1: Write the failing test**

```js
/**
 * runner-loopback-forward.test.js — bug1 通治层守卫：
 * line-strategist/ci-patrol 等 SKILL.md 硬编码 localhost:5221，
 * 容器内必须有 127.0.0.1:5221 → host.docker.internal:5221 回环转发，
 * 否则所有容器内 Brain API 写库静默失败（issue 219a9efc 零落库）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../../../..');

describe('runner 镜像回环转发', () => {
  it('Dockerfile 安装 socat', () => {
    const df = readFileSync(path.join(ROOT, 'docker/cecelia-runner/Dockerfile'), 'utf8');
    expect(df).toMatch(/\bsocat\b/);
  });

  it('entrypoint.sh 起 127.0.0.1:5221 → host.docker.internal:5221 转发', () => {
    const ep = readFileSync(path.join(ROOT, 'docker/cecelia-runner/entrypoint.sh'), 'utf8');
    expect(ep).toMatch(/socat\s+TCP-LISTEN:5221/);
    expect(ep).toMatch(/host\.docker\.internal:5221/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/runner-loopback-forward.test.js 2>&1 | tail -10`
Expected: FAIL（Dockerfile 无 socat）

- [ ] **Step 3: Commit failing test**

```bash
git add packages/brain/src/__tests__/runner-loopback-forward.test.js
git commit -m "test: runner 镜像回环转发守卫 failing test（bug1 通治层）"
```

- [ ] **Step 4: Implement**

4a. Dockerfile 第一段 apt 列表 `python3-minimal \` 后加一行：

```dockerfile
       socat \
```

4b. entrypoint.sh 在 `# 3.5 v6 P1-D` 段之前（即 `git config --global --add safe.directory '*'` 之后）插入：

```bash
# 3.2 Brain API 回环转发（issue 219a9efc 零落库根修·通治层）
# 众多 SKILL.md（line-strategist / ci-patrol / db-update…）硬编码 localhost:5221，
# bridge 容器内 localhost 是容器自己 → 所有写库 curl 静默失败、skill 照常 exit 0。
# 此处把容器内 127.0.0.1:5221 转发到宿主（--add-host host.docker.internal:host-gateway
# 由 docker-executor 注入）。host.docker.internal 不可解析时跳过（非 Brain 派发场景）。
if getent hosts host.docker.internal >/dev/null 2>&1; then
  socat TCP-LISTEN:5221,bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:5221 &
  echo "[entrypoint] loopback forward 127.0.0.1:5221 -> host.docker.internal:5221 (pid $!)"
fi
```

- [ ] **Step 5: Run test to verify pass**

Run: `cd packages/brain && npx vitest run src/__tests__/runner-loopback-forward.test.js 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add docker/cecelia-runner/Dockerfile docker/cecelia-runner/entrypoint.sh
git commit -m "fix(runner): 镜像加 socat 回环转发——容器内 localhost:5221 通治所有硬编码 skill"
```

---

### Task 5: 版本 bump + DevGate + 汇总验证

**Files:**
- Modify: `packages/brain/package.json`（patch bump）
- Modify: 版本同步涉及文件（由 `bash scripts/check-version-sync.sh` 输出指引，通常含 `packages/brain/src/server.js` 或 version 常量文件）

- [ ] **Step 1: 版本 bump**

```bash
cd packages/brain && npm version patch --no-git-tag-version && cd ../..
bash scripts/check-version-sync.sh
```

Expected: 若报不同步，按其输出把其余登记处同步到新版本号，直到通过。

- [ ] **Step 2: DevGate**

```bash
node scripts/facts-check.mjs
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 全部通过。

- [ ] **Step 3: 跑本任务全部测试文件（禁全量）**

```bash
cd packages/brain && npx vitest run \
  src/__tests__/actions.test.js \
  src/__tests__/monitor-stuck-terminal.test.js \
  src/__tests__/monitor-loop.test.js \
  src/__tests__/monitor-loop-p2.test.js \
  src/__tests__/docker-brain-url.test.js \
  src/__tests__/runner-loopback-forward.test.js \
  src/__tests__/docker-executor.test.js \
  src/__tests__/callback-resilience.test.js 2>&1 | tail -15
```

Expected: 全 PASS。

- [ ] **Step 4: 语法冒烟（brain deploy 前置铁律）**

```bash
node --check packages/brain/src/server.js && node --check packages/brain/src/executor.js && node --check packages/brain/src/monitor-loop.js && node --check packages/brain/src/actions.js && node --check packages/brain/src/docker-executor.js
```

Expected: 无输出（全过）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(brain): version bump + DevGate 通过"
```

---

## 合并后（不在本 plan 的 commit 内，收尾时执行）

1. `bash scripts/brain-deploy.sh`（Gate3 自动部署为主，盯 5221 版本）
2. 重建 runner 镜像：`bash docker/build.sh`（或 docker build docker/cecelia-runner）
3. proven-to-fire 重放：注册一条 strategist_decision（ce22c955 同参 journey bb8cc561），容器执行后验收 ①decisions/notes 落库 ②result 非空 ③completed 后 10 分钟不被打回。
