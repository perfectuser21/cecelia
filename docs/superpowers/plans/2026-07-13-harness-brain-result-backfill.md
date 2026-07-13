# harness Brain 侧三修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 harness report 回写路径（result 持久化 + completed 幂等补写）、relay-runs task_id 过滤、sprint_dir 重派漂移三处 Brain 侧根因（issue a638f840 / 45dd6925）。

**Architecture:** 三个独立小修，各自 TDD 两 commit（failing test → 实现）。全部纯逻辑接缝，CI regression test 即守卫。

**Tech Stack:** Node ESM + express + pg（jsonb COALESCE merge）+ vitest（vi.mock db.js + supertest / deps 注入）。

**Spec:** docs/superpowers/specs/2026-07-13-harness-brain-result-backfill-design.md

---

### Task 1: tasks.js PATCH — result 持久化 + status 幂等 no-op + 必填放宽

**Files:**
- Modify: `packages/brain/src/routes/tasks.js`（PATCH handler，约 357-500 行）
- Test: `packages/brain/src/routes/__tests__/tasks-result-backfill.test.js`（新建）

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/routes/__tests__/tasks-result-backfill.test.js`：

```javascript
/**
 * routes/tasks.js — PATCH result 持久化 + completed 幂等补写 [BEHAVIOR]
 *
 * issue a638f840 实证：harness-report Step 1 回写 task.result 双重损坏——
 * ① handler setClauses 从不写 result 列（happy path 也静默丢弃）
 * ② task 已 completed 后补写被 INVALID_TRANSITION 409 永久堵死。
 * 修法：result COALESCE merge 写入；status===currentStatus 视为幂等 no-op
 * （跳过 transition 校验/status_history/事件），仍应用 result 更新。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

describe('PATCH /api/brain/tasks/:task_id — result 补写 [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    // 默认兜底：事件/KR 等后续查询一律返回空行，防未 mock 的调用炸 rows
    mockQuery.mockResolvedValue({ rows: [] });
    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  it('completed task + body.result → 200 且 UPDATE 含 result COALESCE merge（补写场景，原 409）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'completed' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] }); // UPDATE

    const res = await request(app)
      .patch('/api/brain/tasks/t1')
      .send({ status: 'completed', result: { pr_url: 'https://x/pr/1', merged: true } });

    expect(res.status).toBe(200);
    const updCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(updCall[0]).toMatch(/result = COALESCE\(result, '\{\}'::jsonb\) \|\|/);
    // 幂等 no-op：不追加 status_history
    expect(updCall[0]).not.toMatch(/status_history/);
  });

  it('completed→completed 无 result → 200 幂等 no-op（不 409、不写 history）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't2', status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t2')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    const updCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(updCall[0]).not.toMatch(/status_history/);
  });

  it('in_progress→completed 带 result → 200 且 status 与 result 同时进 UPDATE', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't3', status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t3')
      .send({ status: 'completed', result: { pr_url: 'https://x/pr/2' } });

    expect(res.status).toBe(200);
    const updCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(updCall[0]).toMatch(/status = \$/);
    expect(updCall[0]).toMatch(/status_history/);
    expect(updCall[0]).toMatch(/result = COALESCE\(result, '\{\}'::jsonb\) \|\|/);
  });

  it('只带 result 无 status → 200（纯补写合法）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't4', status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t4')
      .send({ result: { total_cost_usd: 7.38 } });

    expect(res.status).toBe(200);
    const updCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(updCall[0]).toMatch(/result = COALESCE/);
    expect(updCall[0]).not.toMatch(/status = \$/);
  });

  it('既无 status 也无 result → 400（守住原必填语义）', async () => {
    const res = await request(app).patch('/api/brain/tasks/t5').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELD');
  });

  it('result 非对象（数组/字符串）→ 400', async () => {
    const res = await request(app)
      .patch('/api/brain/tasks/t6')
      .send({ result: [1, 2] });
    expect(res.status).toBe(400);
  });

  it('回归哨兵：completed → failed 仍 409（终态间迁移不放行）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't7', status: 'completed' }] });
    const res = await request(app)
      .patch('/api/brain/tasks/t7')
      .send({ status: 'failed' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });
});

- [ ] **Step 2: 跑测试确认 Red**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/tasks-result-backfill.test.js`
Expected: 前 4 个用例 FAIL（409 / SQL 无 result），后 3 个可能已过（守住语义的哨兵）。

- [ ] **Step 3: commit failing test（commit-1）**

```bash
git add packages/brain/src/routes/__tests__/tasks-result-backfill.test.js
git commit -m "test(brain): [RED] PATCH tasks result 补写 regression tests — issue a638f840"
```

- [ ] **Step 4: 实现**

`packages/brain/src/routes/tasks.js` PATCH handler 改动（以现文件 357 行起的 handler 为基准）：

(a) 解构与必填放宽——把
```javascript
    const { status } = req.body;

    // Require status
    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: status',
        code: 'MISSING_FIELD'
      });
    }
```
改为
```javascript
    const { status, result } = req.body;

    // Require status or result（result 纯补写合法 — issue a638f840 report Step1 场景）
    if (!status && result === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: status or result',
        code: 'MISSING_FIELD'
      });
    }

    // result 必须是普通对象（jsonb || 合并语义）
    if (result !== undefined && (result === null || typeof result !== 'object' || Array.isArray(result))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid result: must be a JSON object',
        code: 'INVALID_RESULT'
      });
    }
```

(b) SELECT 后（`const currentStatus = task.status;` 行后）加：
```javascript
    // status === currentStatus → 幂等 no-op：跳过 transition 校验与事件，仅应用 result 等字段
    const isStatusNoop = Boolean(status) && status === currentStatus;
```

(c) transition 校验块条件 `if (status) {` 改为 `if (status && !isStatusNoop) {`（allowedTransitions 表本身不动）。

(d) setClauses 构建块条件同改：`if (status && !isStatusNoop) {`（status/status_history/claimed_by/executor_kind 整块只在真迁移时生效）。并在该块之后追加：
```javascript
    if (result !== undefined) {
      setClauses.push(`result = COALESCE(result, '{}'::jsonb) || $${paramIdx++}::jsonb`);
      params.push(JSON.stringify(result));
    }
```

(e) UPDATE 之后的事件块条件 `if (status) {` 改为 `if (status && !isStatusNoop) {`（emitEvent / promoteRegressionOnHarnessMerged / KR 重算全部只在真迁移时触发）。

- [ ] **Step 5: 跑测试确认 Green**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/tasks-result-backfill.test.js src/routes/__tests__/tasks-canceled-transition.test.js`
Expected: 全 PASS（含既有 canceled 回归不破）。

- [ ] **Step 6: commit 实现（commit-2）**

```bash
git add packages/brain/src/routes/tasks.js
git commit -m "fix(brain): PATCH tasks 支持 result COALESCE 持久化 + completed 幂等补写 — issue a638f840"
```

---

### Task 2: GET /relay-runs 支持 ?task_id= 过滤

**Files:**
- Modify: `packages/brain/src/routes/initiatives.js`（GET /relay-runs handler，212-310 行）
- Test: `packages/brain/src/__tests__/relay-runs-task-id-filter.test.js`（新建）

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/__tests__/relay-runs-task-id-filter.test.js`：

```javascript
/**
 * GET /api/brain/orchestrator/relay-runs?task_id= 过滤 [BEHAVIOR]
 *
 * issue a638f840：harness-report TOTAL_COST fallback 需要按 task 查 relay runs
 * 求和 cost_usd，此前列表端点只支持 limit/phase/since。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

const TASK_ID = 'aaaabbbb-1111-2222-3333-444455556666';

describe('GET /relay-runs?task_id=', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  it('合法 uuid → 200 且 SQL 含 current_task_id 条件、参数透传', async () => {
    const app = await buildApp();
    const res = await request(app).get(`/api/brain/orchestrator/relay-runs?task_id=${TASK_ID}`);
    expect(res.status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/current_task_id = \$/);
    expect(params).toContain(TASK_ID);
  });

  it('task_id 与 phase 组合过滤共存', async () => {
    const app = await buildApp();
    const res = await request(app).get(`/api/brain/orchestrator/relay-runs?task_id=${TASK_ID}&phase=evaluate`);
    expect(res.status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/current_task_id = \$/);
    expect(sql).toMatch(/phase = \$/);
    expect(params).toContain(TASK_ID);
    expect(params).toContain('evaluate');
  });

  it('非法 task_id（非 uuid）→ 400', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/orchestrator/relay-runs?task_id=not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('响应行含 current_task_id 字段（消费方按 task 求和 cost_usd 需要核对归属）', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'r1', current_task_id: TASK_ID, cost_usd: '7.38', phase: 'done' }],
    });
    const app = await buildApp();
    const res = await request(app).get(`/api/brain/orchestrator/relay-runs?task_id=${TASK_ID}`);
    expect(res.status).toBe(200);
    expect(res.body[0].current_task_id).toBe(TASK_ID);
  });
});
```

- [ ] **Step 2: 跑测试确认 Red**

Run: `cd packages/brain && npx vitest run src/__tests__/relay-runs-task-id-filter.test.js`
Expected: 前两个与第四个 FAIL（SQL 无 current_task_id），第三个 FAIL（无校验时 200）。

- [ ] **Step 3: commit failing test（commit-1）**

```bash
git add packages/brain/src/__tests__/relay-runs-task-id-filter.test.js
git commit -m "test(brain): [RED] relay-runs task_id 过滤 regression tests — issue a638f840"
```

- [ ] **Step 4: 实现**

`packages/brain/src/routes/initiatives.js` GET /relay-runs handler：

(a) since 校验块之后（`sinceDate = rawSince;` 的闭合 `}` 后）加：
```javascript
  // 解析并校验 task_id 参数（issue a638f840：report TOTAL_COST 按 task 求和）
  const rawTaskId = req.query.task_id;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (rawTaskId !== undefined && !UUID_RE.test(rawTaskId)) {
    return res.status(400).json({ error: 'task_id 参数必须为合法 UUID' });
  }
```

(b) `buildConditionsAndParams()` 里 phase 条件块之后、`params.push(limit)` 之前加：
```javascript
      if (rawTaskId !== undefined) {
        params.push(rawTaskId);
        conditions.push(`current_task_id = $${params.length}`);
      }
```

(c) 两个 SELECT 列表（主查询 + pr_url 回退查询）都在 `id, initiative_id, phase,` 后加一列 `current_task_id,`。

- [ ] **Step 5: 跑测试确认 Green（含既有 relay-runs 族回归）**

Run: `cd packages/brain && npx vitest run src/__tests__/relay-runs.test.js src/__tests__/relay-runs-filter.test.js src/__tests__/relay-runs-since.test.js src/__tests__/relay-runs-task-id-filter.test.js`
Expected: 全 PASS。

- [ ] **Step 6: commit 实现（commit-2）**

```bash
git add packages/brain/src/routes/initiatives.js
git commit -m "feat(brain): relay-runs 列表支持 ?task_id= 过滤 + 返回 current_task_id — issue a638f840"
```

---

### Task 3: spawn 持久化缺省生成的 sprint_dir

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js`（无头路径 ~183 行、有头路径 ~350 行）
- Test: `packages/brain/src/__tests__/harness-skill-relay.test.js`（追加用例）

- [ ] **Step 1: 写 failing test**

在 `packages/brain/src/__tests__/harness-skill-relay.test.js` 的「spawn 时把判定结果持久化进 task payload」用例之后追加（同一 describe 内，deps 注入模式照抄该用例）：

```javascript
  it('payload 无 sprint_dir 时 spawn 持久化生成的 sprint_dir（issue 45dd6925 重派漂移）', async () => {
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({}),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('t'),
      now: () => new Date('2026-07-05T12:00:00Z'),
    };
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00002222', title: 'feat: 无 sprint_dir 任务', payload: { orchestrator: 'skill-relay' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const upd = deps.pool.query.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql) && /sprint_dir/.test(sql));
    expect(upd, '必须 UPDATE tasks payload.sprint_dir').toBeTruthy();
    expect(upd[1]).toContain(task.id);
    expect(String(upd[1][1])).toMatch(/^sprints\//);
  });

  it('payload 已有 sprint_dir 时不回写（不覆盖 /dev 交接值）', async () => {
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({}),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('t'),
      now: () => new Date('2026-07-05T12:00:00Z'),
    };
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00003333', title: 'feat: 带 sprint_dir', payload: { orchestrator: 'skill-relay', sprint_dir: 'sprints/x' } };
    await spawnSkillRelaySession(task, deps);
    const upd = deps.pool.query.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql) && /sprint_dir/.test(sql));
    expect(upd).toBeFalsy();
  });
```

- [ ] **Step 2: 跑测试确认 Red**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js`
Expected: 新增第一个用例 FAIL（找不到 sprint_dir UPDATE），第二个已过；既有用例全过。

- [ ] **Step 3: commit failing test（commit-1）**

```bash
git add packages/brain/src/__tests__/harness-skill-relay.test.js
git commit -m "test(brain): [RED] spawn 持久化 sprint_dir regression tests — issue 45dd6925"
```

- [ ] **Step 4: 实现**

`packages/brain/src/harness-skill-relay.js` 两处（无头 ~183 / 有头 ~350，变量都叫 `dbPool` 与 `sprintDir`），在 sprintDir 计算语句之后各加：

```javascript
    // issue 45dd6925：缺省生成的 sprint_dir 必须回写 payload，否则重派换新目录（断点恢复产物路径漂移）
    if (!task.payload?.sprint_dir) {
      try {
        await dbPool.query(
          `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('sprint_dir', $2::text)
            WHERE id = $1`,
          [task.id, sprintDir]
        );
      } catch (err) {
        console.warn(`[skill-relay] sprint_dir 持久化失败（不阻塞）: ${err.message}`);
      }
    }
```

注意无头路径该段放在 review_required 持久化块的相邻位置（之前或之后均可），有头路径放在 `const sprintDir = ...` 之后、inDocker 判定之前。

- [ ] **Step 5: 跑测试确认 Green**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js`
Expected: 全 PASS。

- [ ] **Step 6: commit 实现（commit-2）**

```bash
git add packages/brain/src/harness-skill-relay.js
git commit -m "fix(brain): spawn 持久化缺省生成的 sprint_dir — issue 45dd6925 重派漂移"
```

---

### Task 4: 版本 bump + smoke + 收尾自查

**Files:**
- Modify: `packages/brain/package.json`（version minor bump）
- Create: `packages/brain/scripts/smoke/task-result-backfill-smoke.sh` + 登记 `packages/quality/smoke-allowlist.txt`

- [ ] **Step 1: brain 版本 bump（minor，feat 语义）**

`packages/brain/package.json` version 字段 bump 一个 minor。

- [ ] **Step 2: smoke 脚本（CI 兼容，node -e 静态断言）**

新建 `packages/brain/scripts/smoke/task-result-backfill-smoke.sh`：

```bash
#!/usr/bin/env bash
# smoke: PATCH tasks result 补写三件套的代码面断言（CI 兼容，不起服务）
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node -e "
const fs = require('fs');
const tasks = fs.readFileSync('packages/brain/src/routes/tasks.js','utf8');
if (!/result = COALESCE\(result, '\{\}'::jsonb\)/.test(tasks)) { console.error('FAIL: tasks.js 缺 result COALESCE 写入'); process.exit(1); }
if (!/isStatusNoop/.test(tasks)) { console.error('FAIL: tasks.js 缺幂等 no-op 分支'); process.exit(1); }
const inits = fs.readFileSync('packages/brain/src/routes/initiatives.js','utf8');
if (!/current_task_id = \\\$/.test(inits)) { console.error('FAIL: initiatives.js 缺 task_id 过滤'); process.exit(1); }
const relay = fs.readFileSync('packages/brain/src/harness-skill-relay.js','utf8');
if (!(relay.match(/jsonb_build_object\('sprint_dir'/g) || []).length >= 2) { console.error('FAIL: skill-relay sprint_dir 持久化少于两处'); process.exit(1); }
console.log('OK: task-result-backfill smoke passed');
"
```

```bash
chmod +x packages/brain/scripts/smoke/task-result-backfill-smoke.sh
echo "packages/brain/scripts/smoke/task-result-backfill-smoke.sh" >> packages/quality/smoke-allowlist.txt
bash packages/brain/scripts/smoke/task-result-backfill-smoke.sh   # 期望 OK
```

- [ ] **Step 3: commit**

```bash
git add packages/brain/package.json packages/brain/scripts/smoke/task-result-backfill-smoke.sh packages/quality/smoke-allowlist.txt
git commit -m "chore(brain): version bump + task-result-backfill smoke"
```
