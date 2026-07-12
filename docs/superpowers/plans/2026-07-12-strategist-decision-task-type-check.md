# strategist_decision task_type CHECK 约束修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `tasks_task_type_check` 约束漏登记 `strategist_decision`，导致战后军师决策环从上线至今从未成功触发的 bug。

**Architecture:** 照 migration 335（golden_path_proposal 先例）DROP+重建 `tasks_task_type_check` 加入 `strategist_decision`；补一个真实 PostgreSQL 集成测试暴露该约束层 bug（现有单测全 mock pool，测不出真实约束拒绝）；顺手修 `dispatchStrategistDecisions` 的韧性问题——当前单个 INSERT 失败会让整个函数抛出，跳过后续所有任务的 `strategist_dispatched` 标记，导致失败事件在窗口过期后永久丢失。

**Tech Stack:** Node.js, PostgreSQL, vitest

## Global Constraints

- 修法必须照 migration 335 的 DROP+重建模式（保留现有全部枚举值，只新增一项）
- 集成测试必须用真实 postgres（不 mock db.js），与 `task-status-transitions.integration.test.js` 同类
- TDD：先写 failing test（commit-1），再实现修复（commit-2）
- 不做 PrepPRD 之外的额外重构

---

### Task 1: Migration 336 — 扩展 tasks_task_type_check 加入 strategist_decision

**Files:**
- Create: `packages/brain/migrations/336_strategist_decision_task_type.sql`

**Interfaces:**
- Consumes: 无
- Produces: DB 层 `strategist_decision` 成为 `tasks.task_type` 合法枚举值，供 Task 2 集成测试和 Task 3 的运行时代码使用

- [ ] **Step 1: 编写 migration 文件**

```sql
-- Migration 336: 扩展 tasks_task_type_check — 加入 strategist_decision
-- 根因：line-strategist-dispatch.js 的 dispatchStrategistDecisions() 创建
-- task_type=strategist_decision 任务时，INSERT 被约束拒绝——该 task_type
-- 从未做 migration 登记进白名单（task-router.js 侧已登记，只缺 DB 约束）。
-- 同 migration 335（golden_path_proposal）同款修法：DROP + 重建，保留现行全部值。

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check CHECK (
  task_type IN (
    'dev', 'review', 'talk', 'data', 'research', 'exploratory',
    'explore', 'knowledge', 'qa', 'audit', 'decomp_review', 'codex_qa',
    'codex_dev', 'codex_test_gen', 'pr_review', 'code_review',
    'initiative_plan', 'initiative_verify', 'initiative_execute',
    'dept_heartbeat', 'suggestion_plan', 'notion_synced',
    'architecture_design', 'architecture_scan', 'arch_review',
    'strategy_session', 'intent_expand', 'cto_review', 'spec_review',
    'code_review_gate', 'prd_review', 'initiative_review',
    'scope_plan', 'project_plan', 'okr_initiative_plan',
    'okr_scope_plan', 'okr_project_plan',
    'content-pipeline', 'content-research', 'content-generate',
    'content-review', 'content-export', 'content_publish',
    'content-copywriting', 'content-copy-review', 'content-image-review',
    'pipeline_rescue', 'crystallize', 'crystallize_scope',
    'crystallize_forge', 'crystallize_verify', 'crystallize_register',
    'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review',
    'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'sprint_report',
    'cecelia_event', 'harness_planner', 'harness_contract_propose',
    'harness_contract_review', 'harness_generate', 'harness_generator',
    'harness_ci_watch', 'harness_evaluate', 'harness_fix',
    'harness_deploy_watch', 'harness_report', 'platform_scraper',
    'harness_initiative', 'harness_task', 'harness_final_e2e',
    'trigger_backup', 'harness_intervention', 'staging_e2e', 'skill_eval',
    'ci_patrol', 'golden_path_proposal', 'strategist_decision'
  )
);

INSERT INTO schema_version (version, description)
VALUES ('336', 'Add strategist_decision to tasks_task_type_check constraint')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: 本地跑一次 migration，确认无报错**

Run: `cd packages/brain && node scripts/migrate.js` （或本仓库既有的 migration runner 命令，先用 `grep -r "migrate" package.json` 确认脚本名）
Expected: 336 应用成功，`schema_version` 表出现 336 行

- [ ] **Step 3: Commit**

```bash
git add packages/brain/migrations/336_strategist_decision_task_type.sql
git commit -m "fix(brain): 336 迁移——tasks_task_type_check 补登记 strategist_decision"
```

---

### Task 2: 真实 PostgreSQL 集成测试（先写 failing，再用 Task 1 的 migration 变绿）

**Files:**
- Create: `packages/brain/src/__tests__/integration/line-strategist-dispatch.integration.test.js`

**Interfaces:**
- Consumes: `dispatchStrategistDecisions(pool, opts)` from `packages/brain/src/line-strategist-dispatch.js`（签名不变：`(pool, { windowMinutes = 10 } = {}) => Promise<{scanned, dispatched, skipped_duplicate, marked}>`）
- Consumes: `DB_DEFAULTS` from `packages/brain/src/db-config.js`
- Produces: 无（叶子测试文件）

- [ ] **Step 1: 写 failing test**

```js
/**
 * line-strategist-dispatch Integration Test（真实 PostgreSQL）
 *
 * 背景：dispatchStrategistDecisions() 的单测（line-strategist-dispatch.test.js）
 * 全程 mock pool.query，从未真实执行过 INSERT INTO tasks(...task_type='strategist_decision'...)。
 * tasks_task_type_check 约束从未登记 strategist_decision，导致该 INSERT 在生产环境
 * 每次都被库拒绝（自上线以来零成功）。mock 测试无法暴露这类约束层 bug，必须用真实 DB 验证。
 *
 * 运行环境：CI brain-unit job（含真实 PostgreSQL 服务），不 mock db.js。
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { dispatchStrategistDecisions } from '../../line-strategist-dispatch.js';

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

const insertedTaskIds = [];

describe('dispatchStrategistDecisions Integration Test（真实 PostgreSQL）', () => {
  afterAll(async () => {
    if (insertedTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [insertedTaskIds]);
    }
    await testPool.end();
  });

  it('真实 INSERT INTO tasks(task_type=strategist_decision) 不被 tasks_task_type_check 约束拒绝', async () => {
    const journeyId = `test-journey-${Date.now()}`;

    const sourceTask = await testPool.query(
      `INSERT INTO tasks (title, description, task_type, priority, status, payload, trigger_source)
       VALUES ($1, $2, 'dev', 'P2', 'completed', $3, 'test')
       RETURNING id`,
      [
        '[TEST-line-strategist-dispatch] source task',
        '集成测试用源任务',
        JSON.stringify({ journey_id: journeyId }),
      ]
    );
    insertedTaskIds.push(sourceTask.rows[0].id);

    const result = await dispatchStrategistDecisions(testPool, { windowMinutes: 10 });

    expect(result.dispatched).toBeGreaterThanOrEqual(1);

    const created = await testPool.query(
      `SELECT id, task_type, status FROM tasks
       WHERE task_type = 'strategist_decision' AND payload->>'journey_id' = $1`,
      [journeyId]
    );
    expect(created.rows.length).toBe(1);
    expect(created.rows[0].task_type).toBe('strategist_decision');
    insertedTaskIds.push(created.rows[0].id);

    const sourceAfter = await testPool.query(
      `SELECT payload->'strategist_dispatched' AS dispatched FROM tasks WHERE id = $1`,
      [sourceTask.rows[0].id]
    );
    expect(sourceAfter.rows[0].dispatched).toBe(true);
  });
});
```

- [ ] **Step 2: 先用 Task 1 之前的（未 migrate）DB 状态跑一次，确认真的会失败**

若测试 DB 已经跑过 Task 1 的 migration，本步骤可跳过（在 Task 1 之前的 commit 上 `git stash` 临时验证也可）。核心目的：证明这条测试在约束未修的世界里会失败（INSERT 报 `violates check constraint tasks_task_type_check`）。

Run: `cd packages/brain && npx vitest run src/__tests__/integration/line-strategist-dispatch.integration.test.js`
Expected（约束未修时）: FAIL，错误信息含 `violates check constraint "tasks_task_type_check"`

- [ ] **Step 3: 确认 Task 1 的 migration 已跑（`schema_version` 含 336），重跑测试**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/line-strategist-dispatch.integration.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/__tests__/integration/line-strategist-dispatch.integration.test.js
git commit -m "test(brain): strategist_decision 真实 postgres 集成测试（暴露 CHECK 约束漏登记）"
```

---

### Task 3: 韧性修复——单个 journey INSERT 失败不应阻断整批任务的 dispatched 标记

**Files:**
- Modify: `packages/brain/src/line-strategist-dispatch.js`
- Modify: `packages/brain/src/__tests__/line-strategist-dispatch.test.js`（追加一个 mock 用例覆盖失败路径）

**Interfaces:**
- Consumes: 无新增
- Produces: `dispatchStrategistDecisions` 返回值新增字段 `failed`（数字，本轮 INSERT 失败的 journey 数），其余字段语义不变

**背景**：当前实现里，某个 journey 的 INSERT 一旦失败（例如约束拒绝、连接抖动），`pool.query` 抛出的异常会直接冒出整个 `dispatchStrategistDecisions` 函数，后面「标记 strategist_dispatched」的循环完全不会执行——包括那些已经成功建了 strategist_decision 任务的、以及本该被标记为已处理但和失败 journey 无关的其它任务。等 10 分钟扫描窗口一过，这些任务的终态事件就永久丢失。修法：把「按 journey 建任务」这段包一层 try/catch，单个 journey 失败不影响其它 journey 继续处理，也不影响后面统一打标记的逻辑（该 journey 分组内的源任务本轮也照常标记，避免下一轮死循环重试同一个必然失败的 journey；失败原因打日志方便排查）。

- [ ] **Step 1: 写 failing 单测（mock pool，覆盖失败路径）**

在 `packages/brain/src/__tests__/line-strategist-dispatch.test.js` 末尾追加：

```js
  it('一个 journey 的 INSERT 失败不影响其它 journey 派发，且失败 journey 的源任务仍被标记', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'task-fail', journey_id: 'journey-fail', status: 'completed' },
        { id: 'task-ok', journey_id: 'journey-ok', status: 'completed' },
      ],
    });
    // journey-fail: 查重通过，INSERT 抛错
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 查重 journey-fail
    mockPool.query.mockRejectedValueOnce(new Error('violates check constraint tasks_task_type_check')); // INSERT 失败
    // journey-ok: 查重通过，INSERT 成功
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 查重 journey-ok
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] }); // INSERT 成功
    // 标记两条源任务
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-fail
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 标记 task-ok

    const result = await dispatchStrategistDecisions(mockPool);

    expect(result).toEqual({
      scanned: 2, dispatched: 1, skipped_duplicate: 0, marked: 2, failed: 1,
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/line-strategist-dispatch.test.js`
Expected: FAIL（当前实现遇到 INSERT reject 会直接抛出未捕获异常，测试报错而非返回值不符）

- [ ] **Step 3: 实现修复**

把 `packages/brain/src/line-strategist-dispatch.js` 中的这段：

```js
  let dispatched = 0;
  let skippedDuplicate = 0;

  for (const [journeyId, group] of byJourney) {
    const dupCheck = await pool.query(
      `SELECT 1 FROM tasks
       WHERE status = 'queued' AND task_type = 'strategist_decision'
         AND payload->>'journey_id' = $1
       LIMIT 1`,
      [journeyId]
    );

    if (dupCheck.rows.length > 0) {
      skippedDuplicate++;
    } else {
      await pool.query(
        `INSERT INTO tasks (title, description, task_type, priority, status, payload, trigger_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          `Line 军师决策 — journey ${journeyId}`,
          `任务终态触发（run_terminal），line-strategist 分析该 line 近期完成/失败任务并给出决策`,
          'strategist_decision',
          'P2',
          'queued',
          JSON.stringify({
            journey_id: journeyId,
            trigger: 'run_terminal',
            trigger_context: { terminal_task_ids: group.map(t => t.id) },
          }),
          'brain_auto',
        ]
      );
      dispatched++;
    }
  }
```

替换为：

```js
  let dispatched = 0;
  let skippedDuplicate = 0;
  let failed = 0;

  for (const [journeyId, group] of byJourney) {
    try {
      const dupCheck = await pool.query(
        `SELECT 1 FROM tasks
         WHERE status = 'queued' AND task_type = 'strategist_decision'
           AND payload->>'journey_id' = $1
         LIMIT 1`,
        [journeyId]
      );

      if (dupCheck.rows.length > 0) {
        skippedDuplicate++;
      } else {
        await pool.query(
          `INSERT INTO tasks (title, description, task_type, priority, status, payload, trigger_source)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            `Line 军师决策 — journey ${journeyId}`,
            `任务终态触发（run_terminal），line-strategist 分析该 line 近期完成/失败任务并给出决策`,
            'strategist_decision',
            'P2',
            'queued',
            JSON.stringify({
              journey_id: journeyId,
              trigger: 'run_terminal',
              trigger_context: { terminal_task_ids: group.map(t => t.id) },
            }),
            'brain_auto',
          ]
        );
        dispatched++;
      }
    } catch (err) {
      failed++;
      console.error(`[line-strategist-dispatch] journey ${journeyId} 派发失败（非致命，本轮仍标记源任务，避免死循环重试）:`, err.message);
    }
  }
```

再把函数末尾的 return 语句：

```js
  return { scanned: terminalTasks.length, dispatched, skipped_duplicate: skippedDuplicate, marked };
```

改为：

```js
  return { scanned: terminalTasks.length, dispatched, skipped_duplicate: skippedDuplicate, marked, failed };
```

- [ ] **Step 4: 跑测试确认通过，且不破坏既有用例**

Run: `cd packages/brain && npx vitest run src/__tests__/line-strategist-dispatch.test.js`
Expected: 全部 PASS（含新用例；既有 4 个用例的 `toEqual` 断言需要确认是否要补 `failed: 0` —— 若 vitest `toEqual` 对多出的 `undefined` 字段容忍失败，需要把既有 4 个 `expect(result).toEqual({...})` 断言补上 `failed: 0`）

- [ ] **Step 5: 修正既有用例（若 Step 4 提示 toEqual 不匹配）**

在 `line-strategist-dispatch.test.js` 中，把已有 4 处：

```js
    expect(result).toEqual({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1 });
```
```js
    expect(result).toEqual({ scanned: 1, dispatched: 0, skipped_duplicate: 1, marked: 1 });
```
```js
    expect(result).toEqual({ scanned: 0, dispatched: 0, skipped_duplicate: 0, marked: 0 });
```
```js
    expect(result).toEqual({ scanned: 2, dispatched: 1, skipped_duplicate: 0, marked: 2 });
```

各自补上 `failed: 0`，例如第一处改为：

```js
    expect(result).toEqual({ scanned: 1, dispatched: 1, skipped_duplicate: 0, marked: 1, failed: 0 });
```

- [ ] **Step 6: 全量重跑确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/line-strategist-dispatch.test.js`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/brain/src/line-strategist-dispatch.js packages/brain/src/__tests__/line-strategist-dispatch.test.js
git commit -m "fix(brain): line-strategist-dispatch 单 journey INSERT 失败不再阻断整批标记"
```

---

### Task 4: 补跑验证（proven-to-fire）+ 集成测试最终确认

**Files:**
- 无新文件；本任务是验证步骤

**Interfaces:**
- Consumes: Task 1-3 全部产出
- Produces: 无

- [ ] **Step 1: 跑 Task 2 的集成测试，确认在真实约束修复后通过**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/line-strategist-dispatch.integration.test.js`
Expected: PASS

- [ ] **Step 2: 跑全量 brain 单测，确认无回归**

Run: `cd packages/brain && npx vitest run`
Expected: 全部 PASS

---

### Task 5（追加需求）：CI 守卫——task-router.js VALID_TASK_TYPES 必须是 DB CHECK 约束值集合的子集

**背景**：本 bug 的根因层是"两张白名单"——`task-router.js` 的 `VALID_TASK_TYPES`（JS 层登记）与 `tasks_task_type_check`（DB 层登记）各自独立维护，`strategist_decision` 在 JS 层登记了，DB 层漏登记，且没有任何机器闸门会发现这种脱节，只能靠生产环境实际 INSERT 失败才暴露。本任务加一个真实 postgres 集成测试，直接从 `information_schema`/`pg_constraint` 解析 DB 约束当前允许的值集合，断言 `VALID_TASK_TYPES` 是它的子集——任何以后再出现"JS 登记了、DB 没登记"的新 task_type，这个测试立即红灯，不用等生产环境真实失败才发现。

**Files:**
- Create: `packages/brain/src/__tests__/integration/task-type-registry-consistency.integration.test.js`

**Interfaces:**
- Consumes: `VALID_TASK_TYPES` from `packages/brain/src/task-router.js`（该文件末尾已 `export { ..., VALID_TASK_TYPES, ... }`，见 `packages/brain/src/task-router.js:937`）
- Consumes: `DB_DEFAULTS` from `packages/brain/src/db-config.js`
- Produces: 无（叶子测试文件）

- [ ] **Step 1: 写 failing test（先确认能从真实 DB 解析出约束值集合）**

```js
/**
 * task-type-registry-consistency Integration Test（真实 PostgreSQL）
 *
 * 根因守卫：task-router.js 的 VALID_TASK_TYPES（JS 层白名单）与
 * tasks_task_type_check（DB 层白名单）是两份独立维护的清单，此前
 * strategist_decision 在 JS 层登记但 DB 层漏登记，导致生产环境
 * INSERT 静默失败到暴露为止无人发现。
 *
 * 本测试直接从真实 DB 的 pg_constraint 解析 tasks_task_type_check
 * 当前允许的值集合，断言 VALID_TASK_TYPES 是它的子集——任何以后
 * 再次出现"JS 登记、DB 未登记"的新 task_type，本测试立即失败，
 * 不必等生产环境真实 INSERT 失败才发现。
 *
 * 运行环境：CI brain-unit job（含真实 PostgreSQL 服务），不 mock db.js。
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { VALID_TASK_TYPES } from '../../task-router.js';

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

afterAll(async () => {
  await testPool.end();
});

async function getDbAllowedTaskTypes() {
  const result = await testPool.query(
    `SELECT pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conname = 'tasks_task_type_check'`
  );
  if (result.rows.length === 0) {
    throw new Error('tasks_task_type_check 约束不存在——DB 未跑到位或约束被重命名');
  }
  const def = result.rows[0].def;
  // pg_get_constraintdef 输出形如: CHECK ((task_type = ANY (ARRAY['dev'::text, 'review'::text, ...])))
  const matches = [...def.matchAll(/'([^']+)'::text/g)];
  return new Set(matches.map(m => m[1]));
}

describe('task-type-registry-consistency Integration Test（真实 PostgreSQL）', () => {
  it('VALID_TASK_TYPES（JS 层白名单）必须是 tasks_task_type_check（DB 层白名单）的子集', async () => {
    const dbAllowed = await getDbAllowedTaskTypes();
    expect(dbAllowed.size).toBeGreaterThan(0);

    const missingFromDb = VALID_TASK_TYPES.filter(t => !dbAllowed.has(t));

    expect(
      missingFromDb,
      `以下 task_type 在 task-router.js VALID_TASK_TYPES 登记但 tasks_task_type_check 约束未登记，` +
      `真实 INSERT 会被 DB 拒绝：${missingFromDb.join(', ')}。` +
      `修法：仿 packages/brain/migrations/336_strategist_decision_task_type.sql 加一条新 migration。`
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试，确认此刻（Task 1-4 已修完）通过**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/task-type-registry-consistency.integration.test.js`
Expected: PASS（因为 Task 1 的 migration 336 已经把 strategist_decision 补进 DB 约束）

- [ ] **Step 3: 验证守卫真的会报红（proven-to-fire）——临时在 VALID_TASK_TYPES 里加一个 DB 没有的假值，确认测试失败**

临时编辑 `packages/brain/src/task-router.js`，在 `VALID_TASK_TYPES` 数组末尾临时加一项 `'__guard_proof_nonexistent_type__'`，重跑：

Run: `cd packages/brain && npx vitest run src/__tests__/integration/task-type-registry-consistency.integration.test.js`
Expected: FAIL，错误信息包含 `__guard_proof_nonexistent_type__`

确认报红后，撤销这个临时改动（`git checkout -- src/task-router.js` 或手动删除那一行），恢复干净状态。

- [ ] **Step 4: 恢复后重跑确认变绿**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/task-type-registry-consistency.integration.test.js`
Expected: PASS

- [ ] **Step 5: 确认 `git status` 干净（无临时改动残留），Commit**

```bash
git status --short
git add packages/brain/src/__tests__/integration/task-type-registry-consistency.integration.test.js
git commit -m "test(brain): 根因守卫——VALID_TASK_TYPES 必须是 tasks_task_type_check 的子集"
```

- [ ] **Step 3: 无需额外 commit（本任务只验证）**
