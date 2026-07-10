# 九要素T9：learnings 噪音过滤 + 摘要可靠性 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** learnings 表停止事件层噪音写入（task_completion / task_completed_auto），所有保留写入路径带 summary，新增 parent_learning_id + verified_effective 两列，[Insight修复] 自动建任务加 confidence 门槛。

**Architecture:** 应用层拦截（不用 DB trigger）：噪音黑名单常量放 learning.js 统一导出，真实拦截点在 auto-learning.js createAutoLearning；task_completion 写入源头（routes/execution.js）整块删除；summary 用既有 generateL0Summary（纯截断，不调 LLM）。migration 330 负责两新列 + 存量 backfill + 历史噪音清理，Brain 启动 runMigrations 自动应用（事务包裹、幂等）。

**Tech Stack:** Node.js ESM、PostgreSQL、vitest（mock-pool 单测 + 真库集成测试并存）。

**上游文档：** 设计 docs/superpowers/specs/2026-07-10-t9-learnings-noise-summary-design.md；PrepPRD sprints/07102000-t9-learnings-noise-summary/prep-prd.md。

**约定：**
- 分支已就位：cp-07102000-t9-learnings-noise-summary（worktree 内）
- 测试命令统一在 worktree 根跑：`npx vitest run <file> --root packages/brain`（若 package script 存在优先 `npm --prefix packages/brain run test -- <file>`；**禁止全量 vitest**——环境级 OOM，见 memory）
- commit 前缀用 `fix(brain/T9):`（**禁用 feat:**，会误触 CI 闸要求 smoke.sh）
- TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每个 task commit-1 = failing test，commit-2 = 实现

---

### Task 1: learning.js — 噪音类目黑名单 + recordLearning 守卫 + confidence 门槛

**Files:**
- Modify: `packages/brain/src/learning.js`（recordLearning，约 :39-132）
- Test: `packages/brain/src/__tests__/learning.test.js`（真库集成测试文件，追加用例）

- [ ] **Step 1: 写 failing test**

在 `learning.test.js` 的 `describe('recordLearning', ...)` 内追加（注意该文件 beforeAll 已从 '../learning.js' 解构导入，需在顶部解构列表补 `NOISE_LEARNING_CATEGORIES, isNoiseLearningCategory`）：

```js
    it('should export noise category blacklist and helper', () => {
      expect(NOISE_LEARNING_CATEGORIES).toContain('task_completion');
      expect(isNoiseLearningCategory('task_completion')).toBe(true);
      expect(isNoiseLearningCategory('failure_pattern')).toBe(false);
    });

    it('should NOT create [Insight修复] task when confidence < 0.7', async () => {
      const analysis = {
        task_id: 'test-task-lowconf',
        analysis: { root_cause: 'lu-test: low confidence root cause unique-A', contributing_factors: [] },
        recommended_actions: [],
        learnings: ['lu-test learning A'],
        confidence: 0.5,
      };
      const learning = await recordLearning(analysis);
      expect(learning).toBeDefined();
      const tasks = await pool.query(
        `SELECT id FROM tasks WHERE payload->>'insight_learning_id' = $1`,
        [learning.id]
      );
      expect(tasks.rows).toHaveLength(0);
    });

    it('should create [Insight修复] task when confidence >= 0.7', async () => {
      const analysis = {
        task_id: 'test-task-highconf',
        analysis: { root_cause: 'lu-test: high confidence root cause unique-B', contributing_factors: [] },
        recommended_actions: [],
        learnings: ['lu-test learning B'],
        confidence: 0.8,
      };
      const learning = await recordLearning(analysis);
      const tasks = await pool.query(
        `SELECT id FROM tasks WHERE payload->>'insight_learning_id' = $1`,
        [learning.id]
      );
      expect(tasks.rows).toHaveLength(1);
    });
```

同时在该文件 beforeAll/afterAll 的清理 SQL 里补一条（两处都加）：

```js
    await pool.query("DELETE FROM tasks WHERE title LIKE '[Insight修复] RCA Learning: lu-test%'");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/learning.test.js --root packages/brain`
Expected: FAIL——`NOISE_LEARNING_CATEGORIES` undefined；low-confidence 用例查到 1 行任务（现在无条件建任务）。

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/learning.test.js
git commit -m "test(brain/T9): recordLearning噪音黑名单+confidence门槛 failing tests"
```

- [ ] **Step 4: 实现**

`packages/brain/src/learning.js`：

(a) 在 import 区之后（约 :20，`recordLearning` 定义之前）加：

```js
// T9 噪音类目黑名单：事件层记录（与 tasks 表信息重复）不配进 learnings 原子准则层账本。
// 真实拦截点在 auto-learning.js createAutoLearning；recordLearning 入口守卫是纵深防御
//（其 category 当前硬编码 failure_pattern，正常不触发）。
export const NOISE_LEARNING_CATEGORIES = ['task_completion'];

export function isNoiseLearningCategory(category) {
  return NOISE_LEARNING_CATEGORIES.includes(category);
}
```

(b) `recordLearning` 内，`const category = 'failure_pattern';`（原 :48 `const category = ...` 行）之后、`const content = ...` 之前加守卫：

```js
  if (isNoiseLearningCategory(category)) {
    console.log(`[learning] Skipping noise category learning: ${category}`);
    return null;
  }
```

(c) [Insight修复] 建任务块（原 :106-132 `// 强制绑定：RCA learning 必须触发 dev task` 的 try 块）：把整个 try 块包进 confidence 门槛：

```js
    // 强制绑定：RCA learning 触发 dev task（Insight-to-Action 闭环）
    // T9: 加 confidence 门槛——低置信 RCA 只落 learning 不建任务，防任务队列噪音
    const INSIGHT_TASK_MIN_CONFIDENCE = 0.7;
    if ((analysis.confidence ?? 0) >= INSIGHT_TASK_MIN_CONFIDENCE) {
      try {
        // …… 原 try 块内容原样保留（taskDedup 查询 + createTask + UPDATE applied）……
      } catch (taskErr) {
        console.warn(`[learning] Failed to create task for learning ${learning.id} (non-fatal):`, taskErr.message);
      }
    } else {
      console.log(`[learning] Skip insight task creation: confidence=${analysis.confidence} < ${INSIGHT_TASK_MIN_CONFIDENCE}`);
    }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/__tests__/learning.test.js --root packages/brain`
Expected: PASS（含既有用例——首个用例 confidence 0.85 仍会建任务，不受影响）。

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/learning.js
git commit -m "fix(brain/T9): 噪音类目黑名单+recordLearning守卫+Insight任务confidence>=0.7门槛"
```

---

### Task 2: auto-learning.js — createAutoLearning 拦噪音 + 补 summary + 停写 completed

**Files:**
- Modify: `packages/brain/src/auto-learning.js`
- Test: `packages/brain/src/__tests__/auto-learning.test.js`（mock-pool 单测，改 2 条既有 + 加 2 条新）

- [ ] **Step 1: 改既有 2 条 completed 用例 + 加 2 条新 failing test**

(a) 既有 `'should create learning for completed dev task'`（约 :73）整体改为：

```js
    it('should NOT create learning for completed task (T9: event-layer noise)', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query.mockResolvedValueOnce({
        rows: [{ task_type: 'dev', title: 'Fix bug' }]
      }); // Task query

      const result = await processExecutionAutoLearning(
        'test-task',
        'completed',
        'Task completed successfully'
      );

      expect(result).toBeNull();
      // 只查了 task 信息，没有 dedup 查询、没有 INSERT
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
```

(b) 既有 `'should include correct metadata for completed task'`（约 :484）整体删除（行为已不存在，metadata 断言由 failed 路径用例继续覆盖——该 describe 内如有 failed 版 metadata 用例保留不动；若无，无需补，failed 路径 metadata 已由 'should create learning for failed task' 类用例覆盖）。

(c) 新增 2 条（放在 `describe('processExecutionAutoLearning', ...)` 内）：

```js
    it('should write non-empty summary column for failed task learning', async () => {
      const { processExecutionAutoLearning } = await import('../auto-learning.js');

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ task_type: 'dev', title: 'Broken task', error_message: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'learning-fail-1', title: '任务失败：fail-task' }] });

      await processExecutionAutoLearning('fail-task', 'failed', { error: 'boom' });

      const insertCall = mockPool.query.mock.calls[2];
      expect(insertCall[0]).toContain('summary');
      const params = insertCall[1];
      const summaryParam = params[params.length - 1]; // summary 是最后一个参数
      expect(typeof summaryParam).toBe('string');
      expect(summaryParam.length).toBeGreaterThan(0);
      expect(summaryParam.length).toBeLessThanOrEqual(100);
    });

    it('should reject noise categories in createAutoLearning', async () => {
      const { createAutoLearning } = await import('../auto-learning.js');
      const result = await createAutoLearning({
        title: 'noise',
        category: 'task_completion',
        content: 'x',
        triggerEvent: 'task_completed',
        metadata: {},
      });
      expect(result).toBeNull();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/auto-learning.test.js --root packages/brain`
Expected: FAIL——completed 用例现在返回对象非 null；`createAutoLearning` 未导出；INSERT 无 summary。

- [ ] **Step 3: commit failing tests**

```bash
git add packages/brain/src/__tests__/auto-learning.test.js
git commit -m "test(brain/T9): auto-learning停写completed+summary列+噪音拦截 failing tests"
```

- [ ] **Step 4: 实现**

`packages/brain/src/auto-learning.js`：

(a) 顶部 import 补：

```js
import { generateL0Summary } from './memory-utils.js';
import { isNoiseLearningCategory } from './learning.js';
```

> ⚠️ 若 learning.js ↔ auto-learning.js 出现循环 import（learning.js 不 import auto-learning，当前无环，直接引用即可；万一 vitest mock 因此报错，把 NOISE_LEARNING_CATEGORIES/isNoiseLearningCategory 挪到 memory-utils.js 并从 learning.js re-export，两边测试断言不变）。

(b) `createAutoLearning` 改为具名导出并加噪音守卫 + summary（原 :67-114）：

```js
export async function createAutoLearning({ title, category, content, triggerEvent, metadata }, dbPool = pool) {
  // T9 噪音类目拦截（真实执行点）
  if (isNoiseLearningCategory(category)) {
    console.log(`[auto-learning] Skipping noise category: ${category}`);
    return null;
  }

  // 预算检查
  if (!hasAutoLearningBudget()) {
    console.log(`[auto-learning] Daily budget exhausted (${DAILY_AUTO_LEARNING_BUDGET}), skipping learning creation`);
    return null;
  }
  // …… 哈希/去重/task_id 防御层 原样保留 ……
```

INSERT 语句改为（summary 追加为最后一列/最后一个参数）：

```js
    const result = await dbPool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested, task_id, summary)
      VALUES ($1, $2, $3, $4, $5, $6, 1, true, false, $7, $8)
      RETURNING id, title
    `, [
      title,
      category,
      triggerEvent,
      content,
      JSON.stringify(metadata || {}),
      contentHash,
      taskIdValid ? taskIdRaw : null,
      generateL0Summary(`${title} ${content}`),
    ]);
```

(c) `handleTaskCompletedLearning`（原 :155-181）函数体整体替换为停写：

```js
export async function handleTaskCompletedLearning(task_id, taskType, _status, _result, _metadata = {}) {
  // T9: 任务完成事件层记录与 tasks 表 result 完全重复，零原子准则价值，停写。
  // 失败路径（handleTaskFailedLearning）保留——失败模式喂反刍系统。
  console.log(`[auto-learning] Skipping completed-task learning for ${task_id} (type=${taskType}): event-layer noise (T9)`);
  return null;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/__tests__/auto-learning.test.js --root packages/brain`
Expected: PASS 全绿（含未改动的 failed 路径用例——注意其 INSERT 断言若含参数个数/位置的硬断言需同步核对 summary 参数追加后仍成立；有红就按新 SQL 修断言）。

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/auto-learning.js packages/brain/src/__tests__/auto-learning.test.js
git commit -m "fix(brain/T9): auto-learning停写completed事件层+INSERT补summary+噪音类目拦截"
```

---

### Task 3: routes/execution.js — 删除 task_completion 写入块

**Files:**
- Modify: `packages/brain/src/routes/execution.js:534-577`（"任务完成 → learnings 闭环" try 块）
- Test: `packages/brain/src/__tests__/t9-noise-source-removed.test.js`（新建，源码断言测试）

- [ ] **Step 1: 写 failing test（源码断言——防回归复挂）**

新建 `packages/brain/src/__tests__/t9-noise-source-removed.test.js`：

```js
/**
 * T9 回归守卫：learnings 表噪音写入源头不得复活。
 * task_completion 事件层记录与 tasks 表信息完全重复（addendum-01 T9）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('T9 noise source removal', () => {
  it('routes/execution.js must not INSERT task_completion learnings', () => {
    expect(src('routes/execution.js')).not.toMatch(/'task_completion'/);
  });

  it('executor.js watchdog failure_pattern INSERT must include summary column', () => {
    const executor = src('executor.js');
    const insertBlock = executor.slice(executor.indexOf("'watchdog_kill'") - 600, executor.indexOf("'watchdog_kill'") + 600);
    expect(insertBlock).toMatch(/INSERT INTO learnings[^;]*summary/s);
  });

  it('routes/tasks.js dev_experience INSERT must include summary column', () => {
    const tasks = src('routes/tasks.js');
    const idx = tasks.indexOf("'dev_experience'");
    const insertBlock = tasks.slice(Math.max(0, idx - 600), idx + 600);
    expect(insertBlock).toMatch(/summary/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/__tests__/t9-noise-source-removed.test.js --root packages/brain`
Expected: FAIL 3 条全红（task_completion 还在；两处 INSERT 无 summary）。

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/t9-noise-source-removed.test.js
git commit -m "test(brain/T9): 噪音源头移除+summary列 源码回归守卫 failing"
```

- [ ] **Step 4: 删除 execution.js 写入块**

删除 `packages/brain/src/routes/execution.js` 中从注释 `// 任务完成 → learnings 闭环：把完成结果写入 learnings 表（让反刍系统消化）` 起到对应 `} catch (learningErr) { ... }` 结束的整个 try/catch 块（约 :534-577，含 `taskMeta` 查询、`findingsSummary`、`learningContent`、contentHash 去重、INSERT、console.log）。保留其前的 `updateDesireFromTask` 调用和其后的 `// content_publish 完成 → ...` 块。

- [ ] **Step 5: 跑该文件相关测试**

Run: `npx vitest run src/__tests__/t9-noise-source-removed.test.js src/__tests__/execution-callback-no-diagnostic.test.js --root packages/brain`
Expected: t9 测试第 1 条转绿（其余 2 条 Task 4 修）；execution-callback 既有测试全绿。

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/routes/execution.js
git commit -m "fix(brain/T9): 删除execution callback的task_completion learnings写入(纯噪音源头)"
```

---

### Task 4: executor.js + routes/tasks.js — INSERT 补 summary

**Files:**
- Modify: `packages/brain/src/executor.js:~1105`（watchdog_kill INSERT）
- Modify: `packages/brain/src/routes/tasks.js:~280`（dev_experience INSERT）

- [ ] **Step 1: executor.js**

顶部 import 补（若无）：`import { generateL0Summary } from './memory-utils.js';`

watchdog_kill INSERT 改为：

```js
      await pool.query(`
        INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested, task_id, summary)
        VALUES ($1, 'failure_pattern', 'watchdog_kill', $2, $3, $4, 1, true, false, $5, $6)
      `, [
        failureTitle,
        failureContent,
        JSON.stringify({ task_id: taskId, task_type: task_type || null, project_id: project_id || null }),
        contentHash,
        taskId || null,
        generateL0Summary(`${failureTitle} ${failureContent}`),
      ]);
```

- [ ] **Step 2: routes/tasks.js**

顶部 import 补（若无）：`import { generateL0Summary } from '../memory-utils.js';`

dev_experience INSERT（learnings-received 循环内）改为：

```js
        const { rows } = await pool.query(
          `INSERT INTO learnings
             (title, category, content, trigger_source, trigger_event, digested,
              source_branch, source_pr, repo, task_id, summary)
           VALUES ($1, 'dev_experience', $2, 'dev_workflow', 'learnings_received', false,
                   $3, $4, $5, $6, $7)
           RETURNING id`,
          [title, step, branch_name || null, pr_number ? String(pr_number) : null, repo, task_id || null, generateL0Summary(step)]
        );
```

- [ ] **Step 3: 跑测试确认全绿**

Run: `npx vitest run src/__tests__/t9-noise-source-removed.test.js src/__tests__/learnings-received.test.js --root packages/brain`
Expected: PASS（learnings-received.test.js 用自建 mock SQL，正常不受影响；若有硬断言红了按新 SQL 修）。

- [ ] **Step 4: commit**

```bash
git add packages/brain/src/executor.js packages/brain/src/routes/tasks.js
git commit -m "fix(brain/T9): watchdog_kill与dev_experience写入路径补summary列"
```

---

### Task 5: migration 330 + selfcheck bump

**Files:**
- Create: `packages/brain/migrations/330_learnings_lineage.sql`
- Modify: `packages/brain/src/selfcheck.js:28`

- [ ] **Step 1: 写 migration（幂等）**

```sql
-- Migration 330: learnings 谱系两列 + summary backfill + task_completion 历史噪音清理
-- 依据: docs/architecture/2026-07-10-nine-elements-integrity/addendum-01（T9）
-- parent_learning_id: 事件层→原子准则层归纳链（自引用）。注意与既有 parent_id（migration 063 去重版本链）语义不同，并存。
-- verified_effective: NULL=未验证 / true/false=验证结论。

ALTER TABLE learnings ADD COLUMN IF NOT EXISTS parent_learning_id UUID REFERENCES learnings(id);
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS verified_effective BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_learnings_parent_learning_id
  ON learnings(parent_learning_id) WHERE parent_learning_id IS NOT NULL;

-- 存量 summary backfill（COALESCE 防 NULL 吞掉结果；只补空行，幂等）
UPDATE learnings
SET summary = LEFT(regexp_replace(COALESCE(title,'') || ' ' || COALESCE(content,''), '\s+', ' ', 'g'), 100)
WHERE summary IS NULL;

-- task_completion 历史噪音清理（写入源头已在代码层移除）
DELETE FROM learnings WHERE category = 'task_completion';
```

- [ ] **Step 2: selfcheck bump**

`packages/brain/src/selfcheck.js:28`：`'326'` → `'330'`。

- [ ] **Step 3: 事务 dry-run 验证（不动生产数据）**

> 本机 cecelia 库即生产库，验证必须 ROLLBACK 包裹：

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d cecelia <<'SQL'
BEGIN;
\i packages/brain/migrations/330_learnings_lineage.sql
SELECT count(*) AS total, count(summary) AS with_summary FROM learnings;
SELECT count(*) AS tc_left FROM learnings WHERE category='task_completion';
SELECT column_name FROM information_schema.columns WHERE table_name='learnings' AND column_name IN ('parent_learning_id','verified_effective');
ROLLBACK;
SQL
```

Expected: `total = with_summary`；`tc_left = 0`；两列名都返回。真正应用由 merge 后 brain-deploy 重启时 runMigrations 自动执行。

- [ ] **Step 4: commit**

```bash
git add packages/brain/migrations/330_learnings_lineage.sql packages/brain/src/selfcheck.js
git commit -m "fix(brain/T9): migration330 谱系两列+summary backfill+task_completion清理; selfcheck bump 330"
```

---

### Task 6: 版本 bump + DevGate + learnings 文档

**Files:**
- Modify: `packages/brain/package.json`（1.245.0 → 1.245.1，patch）
- Create: `docs/learnings/cp-07102000-t9-learnings-noise.md`

- [ ] **Step 1: bump + DevGate 三查**

```bash
cd packages/brain && npm version patch --no-git-tag-version && cd ../..
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 三查全过（version-sync 若报其他文件需同步，按其输出补齐——如 package-lock 两处，见 memory version-management）。

- [ ] **Step 2: learnings 文档（首 push 前写进 commit，含固定三段）**

`docs/learnings/cp-07102000-t9-learnings-noise.md`：

```markdown
# T9: learnings 表噪音过滤 + 摘要可靠性

### 根本原因
- learnings 表 summary 覆盖率 6% 的根因不是 generateL0Summary 失败（它是纯截断），
  而是 6 条写入路径里 4 条 INSERT 根本没带 summary 列——"低成功率"是列缺失，不是函数缺陷。
- 事件层噪音（task_completion / task_completed_auto，共 106 行 + dev_experience 无摘要 6211 行）
  与 tasks 表信息完全重复，淹没原子准则层。
- 任务描述假设"dispatch-helpers RCA 路径是噪音主因"被数据证伪（仅 4 行）；
  真噪音在 execution callback 与 auto-learning 事件层。修前先量化来源分布避免修错靶子。

### 下次预防
- [ ] 新增 learnings INSERT 路径必须带 summary（t9-noise-source-removed.test.js 源码守卫已卡两处，新增路径时补断言）
- [ ] "某表某列覆盖率低"类问题先按 category/trigger_event 分组统计定位写入方，再谈修函数
- [ ] 自动建任务的闭环机制（Insight-to-Action）必须带置信门槛，无条件触发=任务队列噪音
```

- [ ] **Step 3: 最终回归（相关文件测试，不跑全量）**

```bash
npx vitest run src/__tests__/learning.test.js src/__tests__/auto-learning.test.js src/__tests__/t9-noise-source-removed.test.js src/__tests__/learnings-received.test.js src/__tests__/execution-callback-no-diagnostic.test.js --root packages/brain
node --check packages/brain/src/server.js
node --check packages/brain/src/routes/execution.js
node --check packages/brain/src/learning.js
node --check packages/brain/src/auto-learning.js
```

Expected: 全绿 + 语法检查无输出。

- [ ] **Step 4: commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json docs/learnings/cp-07102000-t9-learnings-noise.md 2>/dev/null; git add -u
git commit -m "fix(brain/T9): version bump 1.245.1 + learnings文档"
```

---

## DoD（PR 描述用）

- [x] [BEHAVIOR] task_completion 噪音源头移除 — Test: tests/ packages/brain/src/__tests__/t9-noise-source-removed.test.js
- [x] [BEHAVIOR] auto-learning 停写 completed 事件层 + INSERT 带 summary — Test: tests/ packages/brain/src/__tests__/auto-learning.test.js
- [x] [BEHAVIOR] recordLearning confidence<0.7 不建 [Insight修复] 任务 — Test: tests/ packages/brain/src/__tests__/learning.test.js
- [x] [BEHAVIOR] migration330 两新列存在且幂等 — Test: manual: node -e "const s=require('fs').readFileSync('packages/brain/migrations/330_learnings_lineage.sql','utf8'); if(!/parent_learning_id/.test(s)||!/verified_effective/.test(s)||!/IF NOT EXISTS/.test(s)) process.exit(1)"
- [x] CI 全绿
