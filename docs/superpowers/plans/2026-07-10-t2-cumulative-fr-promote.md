# T2 累积 FR 通电 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** harness 任务 merged 终态自动把 Golden Path 冻结进 golden_path 表（dbOnly、fail-open、幂等），读端 SQL 改走 golden_path.feature_id 直连，累积 FR 从 0 行开始沉淀。

**Architecture:** 新逻辑单点放 `lib/callback-postprocess.js`（反分叉铁律），4 个终态路径（callback 双路径 / tasks PATCH / relay-watchdog）调同一函数；`promoteToRegression` 加 dbOnly + feature_id 兜底 + worktree 收割兜底；读端两处同源 SQL（harness-line-context / abilities 端点）同步对齐。

**Tech Stack:** Node.js ESM、pg、vitest（mock pool 单测 + 真 postgres 集成测试）、bash smoke。

**Spec:** docs/superpowers/specs/2026-07-10-t2-cumulative-fr-promote-design.md

**铁律：** TDD——NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。每个 Task commit 顺序：commit-1 failing test / commit-2 实现。

---

### Task 1: promoteToRegression 加 dbOnly + feature_id 兜底

**Files:**
- Modify: `packages/brain/src/harness-promote-regression.js:124`（params 解构）、`:155-163`（featureId 逻辑）、`:183` 后（dbOnly 返回）
- Test: `packages/brain/src/__tests__/harness-promote-regression.test.js`（追加用例，复用现有 makeDeps/GOOD 夹具）

- [ ] **Step 1: 写 failing test**

在 `harness-promote-regression.test.js` 的 `describe('promoteToRegression')` 内追加（照现有用例的 makeDeps 风格；先读该文件确认夹具函数名，以下按现有 `makeDeps` 约定书写，若实际名不同按实际改）：

```js
  it('dbOnly=true 时写完 DB 直接返回，不跑 git/yaml', async () => {
    const { deps, execFileCalls, clientQueries } = makeDeps();
    const res = await promoteToRegression(deps, {
      task: { id: TASK_ID, payload: {} },
      sprintDir: 'sprints/test', subTasks: [], worktreePath: '/wt',
      dbOnly: true,
    });
    expect(res).toEqual({ ok: true, dbWritten: true, yamlPrUrl: null, reason: 'db_only' });
    expect(execFileCalls.length).toBe(0); // 没碰 git ls-files / checkout / gh
  });

  it('payload.feature_id 缺失时回退 task.ability_id 写入 feature_id', async () => {
    const ABILITY = '99999999-9999-4999-8999-999999999999';
    const { deps, clientQueries } = makeDeps();
    await promoteToRegression(deps, {
      task: { id: TASK_ID, ability_id: ABILITY, payload: {} },
      sprintDir: 'sprints/test', subTasks: [], worktreePath: '/wt',
      dbOnly: true,
    });
    const inserts = clientQueries.filter(([sql]) => sql.includes('INSERT INTO golden_path'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const [, params] of inserts) expect(params[2]).toBe(ABILITY);
  });
```

注意：makeDeps 的 mock client 需要让 `SELECT id FROM journey_features WHERE id=$1` 返回 `{ rows: [{ id: <入参> }] }`（现有夹具若已按 SQL 路由，加一条分支即可）。若现有夹具没有 execFileCalls/clientQueries 记录数组，按现有 mock 结构等价断言（如 `deps.execFile` 是 vi.fn() 则断言 `not.toHaveBeenCalled()`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-promote-regression.test.js`
Expected: 新增 2 用例 FAIL（dbOnly 未实现 → 走到 git 校验 / feature_id 兜底不存在）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/harness-promote-regression.test.js
git commit -m "test: promoteToRegression dbOnly 与 feature_id 兜底 failing test (T2)"
```

- [ ] **Step 4: 实现**

`packages/brain/src/harness-promote-regression.js`：

(a) :124 解构加 dbOnly：

```js
  const { task, sprintDir, subTasks, worktreePath, dbOnly = false } = params;
```

(b) :155-163 featureId 逻辑替换为（payload.feature_id 优先，缺失/无效回退 task.ability_id）：

```js
      // feature_id 验证存在，失败留 NULL（schema ON DELETE SET NULL 语义一致）。
      // payload.feature_id 缺失时回退 tasks.ability_id——读端 join gp.feature_id 直连，
      // NULL 行会被滤掉，写端必须尽力落真 FK（九要素 T2）。
      let featureId = null;
      for (const cand of [task?.payload?.feature_id, task?.ability_id]) {
        if (!cand) continue;
        try {
          const fe = await client.query('SELECT id FROM journey_features WHERE id=$1', [cand]);
          if (fe.rows[0]?.id) { featureId = fe.rows[0].id; break; }
        } catch { /* keep null */ }
      }
```

(c) ① 事务 try/catch 整块结束后（原 :183 的 `}` 之后、"② commit 校验"注释之前）插入：

```js
  if (dbOnly) {
    console.log(`[promote-regression] dbOnly 完成 task=${taskId}（yaml PR 跳过）`);
    return { ok: true, dbWritten, yamlPrUrl: null, reason: 'db_only' };
  }
```

(d) 函数 JSDoc `@param` 行补 `dbOnly` 说明：`dbOnly: 只执行 ① golden_path DB 写入，跳过 commit 校验与 yaml PR（九要素 T2 首版）`。

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-promote-regression.test.js`
Expected: 全部 PASS（含原有用例——featureId 改动不得破坏原 payload.feature_id 用例）

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/harness-promote-regression.js
git commit -m "feat(brain/T2): promoteToRegression 支持 dbOnly + feature_id 回退 ability_id"
```

---

### Task 2: 共享管道新增 promoteRegressionOnHarnessMerged

**Files:**
- Modify: `packages/brain/src/lib/callback-postprocess.js`（文件头注释 + 末尾新函数）
- Create: `packages/brain/src/__tests__/callback-postprocess-promote.test.js`

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/__tests__/callback-postprocess-promote.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const promoteMock = vi.fn(async () => ({ ok: true, dbWritten: true, yamlPrUrl: null, reason: 'db_only' }));
vi.mock('../harness-promote-regression.js', () => ({
  promoteToRegression: promoteMock,
  default: { promoteToRegression: promoteMock },
}));

const { promoteRegressionOnHarnessMerged } = await import('../lib/callback-postprocess.js');

const TASK_ID = '11111111-1111-4111-8111-111111111111';

function makePool(taskRow) {
  return { query: vi.fn(async () => ({ rows: taskRow ? [taskRow] : [] })) };
}

describe('promoteRegressionOnHarnessMerged', () => {
  beforeEach(() => promoteMock.mockClear());

  it('非 harness_initiative 任务静默跳过', async () => {
    const pool = makePool({ id: TASK_ID, task_type: 'dev', ability_id: null, payload: {}, pr_url: 'https://github.com/x/y/pull/1' });
    await promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it('无 merged PR 证据时跳过', async () => {
    const pool = makePool({ id: TASK_ID, task_type: 'harness_initiative', ability_id: null, payload: { sprint_dir: 'sprints/x' }, pr_url: null });
    await promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it('payload 缺 sprint_dir 时跳过', async () => {
    const pool = makePool({ id: TASK_ID, task_type: 'harness_initiative', ability_id: null, payload: {}, pr_url: 'https://github.com/x/y/pull/1' });
    await promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it('有证据时以 dbOnly:true 调 promoteToRegression，带 ability_id 与 sprint_dir', async () => {
    const pool = makePool({
      id: TASK_ID, task_type: 'harness_initiative',
      ability_id: '22222222-2222-4222-8222-222222222222',
      payload: { sprint_dir: 'sprints/0710-x' }, pr_url: null,
    });
    await promoteRegressionOnHarnessMerged(TASK_ID, { merged: true, pr_url: 'https://github.com/x/y/pull/9' }, null, pool);
    expect(promoteMock).toHaveBeenCalledTimes(1);
    const [deps, params] = promoteMock.mock.calls[0];
    expect(deps.pool).toBe(pool);
    expect(params.dbOnly).toBe(true);
    expect(params.sprintDir).toBe('sprints/0710-x');
    expect(params.task).toMatchObject({ id: TASK_ID, ability_id: '22222222-2222-4222-8222-222222222222' });
    expect(params.subTasks).toEqual([{ pr_url: 'https://github.com/x/y/pull/9' }]);
    expect(typeof params.worktreePath).toBe('string');
    expect(params.worktreePath.length).toBeGreaterThan(0);
  });

  it('payload.worktree_path 优先于推导路径', async () => {
    const pool = makePool({
      id: TASK_ID, task_type: 'harness_initiative', ability_id: null,
      payload: { sprint_dir: 'sprints/0710-x', worktree_path: '/tmp/custom-wt' }, pr_url: 'https://github.com/x/y/pull/2',
    });
    await promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool);
    expect(promoteMock.mock.calls[0][1].worktreePath).toBe('/tmp/custom-wt');
  });

  it('promoteToRegression 抛错不外抛（fail-open 由调用方 catch，本层也不炸）', async () => {
    promoteMock.mockRejectedValueOnce(new Error('boom'));
    const pool = makePool({
      id: TASK_ID, task_type: 'harness_initiative', ability_id: null,
      payload: { sprint_dir: 'sprints/0710-x' }, pr_url: 'https://github.com/x/y/pull/3',
    });
    await expect(promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool)).rejects.toThrow('boom');
    // 说明：本函数不吞错，由 4 个调用点 .catch 只 warn（与 serialUnlockNext 同风格）
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/callback-postprocess-promote.test.js`
Expected: FAIL（promoteRegressionOnHarnessMerged is not a function）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/callback-postprocess-promote.test.js
git commit -m "test: promoteRegressionOnHarnessMerged failing test (T2)"
```

- [ ] **Step 4: 实现**

`packages/brain/src/lib/callback-postprocess.js`：

(a) 文件头注释"当前包含"列表加一行：

```
 *   - promoteRegressionOnHarnessMerged (T2) harness 任务 merged 终态→golden_path 冻结（dbOnly）
```

(b) 文件末尾追加：

```js
/**
 * T2. harness 任务 merged 终态 → promoteToRegression（累积 FR 通电，九要素 T2）
 *
 * 只写 golden_path 表（dbOnly:true），yaml PR ② 本版不通电（架构文档风险条）。
 * 多路触发幂等安全：promoteToRegression ① 为 DELETE by owner_task_id + INSERT 覆盖写。
 * 调用点（4 处，全部 .catch 只 warn）：callback-processor.js / routes/execution.js /
 * routes/tasks.js PATCH completed / harness-relay-watchdog.js 两处直写。
 *
 * @param {string} task_id
 * @param {any}    result  - callback/PATCH body 里的 result（可 null）
 * @param {string} pr_url  - 已知 merged PR URL（可 null，回退 tasks.pr_url / result.pr_url）
 * @param {object} pool    - pg Pool
 */
export async function promoteRegressionOnHarnessMerged(task_id, result, pr_url, pool) {
  const { rows } = await pool.query(
    'SELECT id, task_type, ability_id, payload, pr_url FROM tasks WHERE id = $1',
    [task_id]
  );
  const task = rows[0];
  if (!task || task.task_type !== 'harness_initiative') return;

  const resultObj = typeof result === 'object' && result !== null ? result : {};
  const effectivePrUrl = pr_url || task.pr_url || resultObj.pr_url || null;
  if (!effectivePrUrl && !resultObj.merged) {
    console.warn(`[callback-postprocess] promoteRegression: task=${task_id} 无 merged PR 证据，跳过`);
    return;
  }

  const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : (task.payload || {});
  const sprintDir = payload.sprint_dir;
  if (!sprintDir) {
    console.warn(`[callback-postprocess] promoteRegression: task=${task_id} payload 缺 sprint_dir，跳过`);
    return;
  }

  const { promoteToRegression } = await import('../harness-promote-regression.js');
  const { harnessTaskWorktreePath, DEFAULT_BASE_REPO } = await import('../harness-worktree.js');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  // worktree 可能已被收割 → 回退主仓（merge 后 sprint 文件已在 main；主仓常驻 main）
  let worktreePath = payload.worktree_path || harnessTaskWorktreePath(task_id);
  if (!existsSync(join(worktreePath, sprintDir, 'sprint-prd.md'))
      && existsSync(join(DEFAULT_BASE_REPO, sprintDir, 'sprint-prd.md'))) {
    worktreePath = DEFAULT_BASE_REPO;
  }

  const outcome = await promoteToRegression(
    { pool },
    {
      task: { id: task.id, ability_id: task.ability_id, payload },
      sprintDir,
      subTasks: [{ pr_url: effectivePrUrl }],
      worktreePath,
      dbOnly: true,
    }
  );
  console.log(`[callback-postprocess] promoteRegression: task=${task_id} dbWritten=${outcome?.dbWritten ?? false} reason=${outcome?.reason || 'ok'}`);
}
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/callback-postprocess-promote.test.js`
Expected: 6 用例全 PASS

- [ ] **Step 6: commit**

```bash
git add packages/brain/src/lib/callback-postprocess.js
git commit -m "feat(brain/T2): 共享管道新增 promoteRegressionOnHarnessMerged（dbOnly, fail-open）"
```

---

### Task 3: 4 个终态路径接线 + smoke 棘轮扩条

**Files:**
- Modify: `packages/brain/src/callback-processor.js:21`（import）、`:291` 后（调用）
- Modify: `packages/brain/src/routes/execution.js`（import 行 + `:1476` 后调用，注意在 `:893` 开的 completed 块内，不是 `:433` 那个）
- Modify: `packages/brain/src/routes/tasks.js`（PATCH handler `status === 'completed'` 分支）
- Modify: `packages/brain/src/harness-relay-watchdog.js`（两处 `UPDATE tasks SET status='completed'` 后）
- Modify: `packages/brain/scripts/smoke/callback-postprocess-smoke.sh`

- [ ] **Step 1: smoke 棘轮先扩条（这是本 Task 的 failing test）**

`callback-postprocess-smoke.sh` 在 `grep -q "export async function writeReviewResult"` 行后加：

```bash
grep -q "export async function promoteRegressionOnHarnessMerged" "$ROOT/src/lib/callback-postprocess.js" && ok "导出 promoteRegressionOnHarnessMerged" || bad "缺 promoteRegressionOnHarnessMerged"
grep -q "promoteRegressionOnHarnessMerged" "$ROOT/src/callback-processor.js" && ok "DB 直写路径已接 promoteRegression" || bad "callback-processor 未接 promoteRegression"
grep -q "promoteRegressionOnHarnessMerged" "$ROOT/src/routes/execution.js" && ok "HTTP 路径已接 promoteRegression" || bad "execution.js 未接 promoteRegression"
grep -q "promoteRegressionOnHarnessMerged" "$ROOT/src/routes/tasks.js" && ok "tasks PATCH 已接 promoteRegression" || bad "routes/tasks.js 未接 promoteRegression"
grep -q "promoteRegressionOnHarnessMerged" "$ROOT/src/harness-relay-watchdog.js" && ok "relay-watchdog 已接 promoteRegression" || bad "harness-relay-watchdog 未接 promoteRegression"
```

- [ ] **Step 2: 跑 smoke 确认红（proven-to-fire）**

Run: `bash packages/brain/scripts/smoke/callback-postprocess-smoke.sh`
Expected: 4 条 bad（callback-processor / execution / tasks / watchdog 未接），exit 1。**必须亲眼看到红**。

- [ ] **Step 3: commit failing smoke**

```bash
git add packages/brain/scripts/smoke/callback-postprocess-smoke.sh
git commit -m "test: smoke 棘轮扩条守 promoteRegression 接线（T2, proven-to-fire）"
```

- [ ] **Step 4: 接线 callback-processor.js**

:21 import 行改为：

```js
import { serialUnlockNext, writeReviewResult, promoteRegressionOnHarnessMerged } from './lib/callback-postprocess.js';
```

:291（serialUnlockNext 调用块）之后加：

```js
    // T2. harness merged 终态 → 累积 FR 冻结（共享后处理管道，dbOnly）
    await promoteRegressionOnHarnessMerged(task_id, result, pr_url, pool).catch(err =>
      console.error(`[callback-processor] promoteRegressionOnHarnessMerged 失败 (non-fatal): ${err.message}`)
    );
```

- [ ] **Step 5: 接线 routes/execution.js**

找到现有 `import { serialUnlockNext, writeReviewResult } from '../lib/callback-postprocess.js'` 行，加 `promoteRegressionOnHarnessMerged`。在 :1476（serialUnlockNext 调用块）之后加：

```js
      // T2. harness merged 终态 → 累积 FR 冻结（共享后处理管道，dbOnly）
      await promoteRegressionOnHarnessMerged(task_id, result, pr_url, pool).catch(err =>
        console.error(`[execution-callback] promoteRegressionOnHarnessMerged 失败 (non-fatal): ${err.message}`)
      );
```

- [ ] **Step 6: 接线 routes/tasks.js PATCH**

PATCH handler 里 `if (status === 'completed')`（KR 进度重算那个块，UPDATE 之后）开头加：

```js
        // T2. harness merged 终态 → 累积 FR 冻结（fail-open；harness-report Step 1 走此路径）
        try {
          const { promoteRegressionOnHarnessMerged } = await import('../lib/callback-postprocess.js');
          await promoteRegressionOnHarnessMerged(task_id, req.body.result || null, req.body.pr_url || null, pool);
        } catch (promoteErr) {
          console.warn(`[tasks-patch] promoteRegressionOnHarnessMerged 失败 (non-fatal): ${promoteErr.message}`);
        }
```

- [ ] **Step 7: 接线 harness-relay-watchdog.js 两处**

第一处（`prState === 'MERGED'` 分支，`UPDATE tasks SET status='completed'` 与 `out.mergedPr++` 之间）加：

```js
            try {
              const { promoteRegressionOnHarnessMerged } = await import('./lib/callback-postprocess.js');
              await promoteRegressionOnHarnessMerged(run.initiative_id, null, effectivePrUrl, dbPool);
            } catch (promoteErr) {
              console.warn(`[relay-watchdog] promoteRegressionOnHarnessMerged 失败 (non-fatal): ${promoteErr.message}`);
            }
```

第二处（`discovered.state === 'MERGED'` 分支，同位置）加同样代码，但 `effectivePrUrl` 换成 `discovered.url`。

- [ ] **Step 8: 跑 smoke 确认绿 + 全量相关单测**

Run: `bash packages/brain/scripts/smoke/callback-postprocess-smoke.sh`
Expected: 全 ok，exit 0

Run: `cd packages/brain && npx vitest run src/__tests__/callback-processor.test.js src/__tests__/callback-dev-serial.test.js src/__tests__/callback-postprocess-promote.test.js src/__tests__/harness-relay-watchdog.test.js 2>/dev/null`（watchdog 测试文件不存在则去掉该项）
Expected: 全 PASS。若 callback-processor.test.js 因新调用查 tasks 行而挂（mock pool 未覆盖新 SELECT），给该测试的 mockPool.query 加对应分支返回 `{ rows: [] }`（task_type 非 harness → 静默跳过，不影响原断言）。

- [ ] **Step 9: node --check 冒烟（brain deploy 死规矩）**

Run: `node --check packages/brain/src/callback-processor.js && node --check packages/brain/src/routes/execution.js && node --check packages/brain/src/routes/tasks.js && node --check packages/brain/src/harness-relay-watchdog.js && node --check packages/brain/src/lib/callback-postprocess.js`
Expected: 无输出（全过）

- [ ] **Step 10: commit**

```bash
git add packages/brain/src/callback-processor.js packages/brain/src/routes/execution.js packages/brain/src/routes/tasks.js packages/brain/src/harness-relay-watchdog.js packages/brain/src/__tests__/
git commit -m "feat(brain/T2): 4 个 harness 终态路径接入 promoteRegression 共享管道"
```

---

### Task 4: 读端 SQL 对齐 golden_path.feature_id（两处同源）

**Files:**
- Modify: `packages/brain/src/harness-line-context.js:7`（注释）、`:84-86`（SQL）
- Modify: `packages/brain/src/routes/abilities.js:276-290`（端点 SQL + 注释）
- Modify: `packages/brain/src/__tests__/harness-line-context.test.js:110-111`（SQL 断言）
- Modify: `packages/brain/scripts/smoke/journey-goldenpaths-invariants-smoke.sh:37`（夹具补 feature_id）

- [ ] **Step 1: 改 test 断言（failing test）**

`harness-line-context.test.js` :110-111 附近，把逐字断言旧 join 的两行改为：

```js
    expect(frSql).toContain('JOIN journey_features jf ON gp.feature_id = jf.id');
    expect(frSql).not.toContain('JOIN tasks t');
```

（变量名以文件实际为准；保持其余断言不动。）同文件若有 mock pool 按 SQL 正则路由累积 FR 查询的分支（匹配 `FROM golden_path`），确认新 SQL 仍命中该正则，不命中则同步更新正则。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-line-context.test.js`
Expected: FAIL（SQL 还是旧 join）

- [ ] **Step 3: commit failing test**

```bash
git add packages/brain/src/__tests__/harness-line-context.test.js
git commit -m "test: line-context 累积 FR SQL 断言改 feature_id 直连 (T2)"
```

- [ ] **Step 4: 改 harness-line-context.js**

:81-88 的 SQL 改为：

```js
    const frRows = await safeQuery('cumulative FR', `
      SELECT jf.id AS ability_id, jf.name AS ability_name, jf.status AS ability_status,
             gp.owner_task_id, gp.id, gp.order_no, gp.feature_id, gp.note
      FROM golden_path gp
      JOIN journey_features jf ON gp.feature_id = jf.id
      WHERE jf.journey_id = $1 AND jf.status IN ('done','working')
      ORDER BY gp.owner_task_id, gp.order_no ASC`, [journeyId]);
```

:7 注释里 `按 owner_task_id 分组` 前补一句：`（读 key=golden_path.feature_id 直连，07-10 T2 对齐；不再绕 tasks.ability_id）`。

- [ ] **Step 5: 改 routes/abilities.js 端点（同源同步）**

`GET /journeys/:journey_id/golden-paths` 的 SQL 改为：

```js
    let sql = `
      SELECT jf.id AS ability_id, jf.name AS ability_name, jf.status AS ability_status,
             gp.owner_task_id, gp.id, gp.order_no, gp.feature_id, gp.note
      FROM golden_path gp
      JOIN journey_features jf ON gp.feature_id = jf.id
      WHERE jf.journey_id = $1`;
```

端点上方注释 `桥：golden_path.owner_task_id → tasks.ability_id → journey_features.journey_id` 改为 `键：golden_path.feature_id → journey_features（T2 对齐，与 harness-line-context.js 同源）`。

- [ ] **Step 6: 改 smoke 夹具**

`journey-goldenpaths-invariants-smoke.sh` :37 的 INSERT 改为（补 feature_id 列，值用已有 `$ABILITY_ID`）：

```bash
psql "$DB_URL" -c "INSERT INTO golden_path (owner_task_id, order_no, feature_id, note) VALUES ('$TASK_ID', 1, '$ABILITY_ID', 'smoke step one'), ('$TASK_ID', 2, '$ABILITY_ID', 'smoke step two')" >/dev/null
```

- [ ] **Step 7: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-line-context.test.js src/__tests__/harness-line-context-wiring.test.js`
Expected: 全 PASS

- [ ] **Step 8: commit**

```bash
git add packages/brain/src/harness-line-context.js packages/brain/src/routes/abilities.js packages/brain/scripts/smoke/journey-goldenpaths-invariants-smoke.sh
git commit -m "feat(brain/T2): 累积 FR 读端两处同源 SQL 对齐 golden_path.feature_id 直连"
```

---

### Task 5: brain-integration 集成测试（真 postgres）

**Files:**
- Create: `packages/brain/src/__tests__/integration/promote-regression.integration.test.js`

- [ ] **Step 1: 写集成测试（本地无真 DB 时以 CI 为准，但先保证语法与逻辑）**

参考同目录 `golden-path.integration.test.js` 的连接方式（先读它抄 setup 约定），内容：

```js
// T2 累积 FR 通电端到端：merged 回调 → golden_path 落行 → line-context 新 SQL 读回
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import { promoteRegressionOnHarnessMerged } from '../../lib/callback-postprocess.js';
import { fetchLineContext } from '../../harness-line-context.js';

const DB_URL = process.env.DATABASE_URL
  || `postgres://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'cecelia_test'}`;

describe('promote-regression integration (T2)', () => {
  let pool, journeyId, abilityId, taskId, tmpDir;
  const SPRINT_DIR = 'sprints/t2-integration';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // 夹具：journey → journey_feature(done) → harness_initiative task(merged)
    const j = await pool.query(
      `INSERT INTO journeys (name, area) VALUES ('t2-int-journey-' || gen_random_uuid(), 'Cecelia') RETURNING id`
    );
    journeyId = j.rows[0].id;
    const f = await pool.query(
      `INSERT INTO journey_features (name, journey_id, kind, status) VALUES ('t2-int-ability', $1, 'ability', 'done') RETURNING id`,
      [journeyId]
    );
    abilityId = f.rows[0].id;
    // tmp worktree 夹具（payload.worktree_path 指向它）
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't2-promote-'));
    fs.mkdirSync(path.join(tmpDir, SPRINT_DIR), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, SPRINT_DIR, 'sprint-prd.md'),
      '# PRD\n\n## Golden Path（核心场景）\n\n1. 用户点击发布\n2. 系统返回成功\n');
    fs.writeFileSync(path.join(tmpDir, SPRINT_DIR, 'contract-dod.md'),
      '- [x] [BEHAVIOR] 发布成功可见\n  Test: manual:node -e "process.exit(0)"\n');
    const t = await pool.query(
      `INSERT INTO tasks (title, task_type, status, ability_id, pr_url, payload)
       VALUES ('t2-int-task', 'harness_initiative', 'completed', $1, 'https://github.com/x/y/pull/1', $2::jsonb)
       RETURNING id`,
      [abilityId, JSON.stringify({ sprint_dir: SPRINT_DIR, worktree_path: tmpDir, journey_id: journeyId })]
    );
    taskId = t.rows[0].id;
  });

  afterAll(async () => {
    if (taskId) await pool.query('DELETE FROM tasks WHERE id=$1', [taskId]);
    if (abilityId) await pool.query('DELETE FROM journey_features WHERE id=$1', [abilityId]);
    if (journeyId) await pool.query('DELETE FROM journeys WHERE id=$1', [journeyId]);
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    await pool.end();
  });

  it('merged 终态 → golden_path 落行且 feature_id 非空（ability_id 兜底）', async () => {
    await promoteRegressionOnHarnessMerged(taskId, { merged: true }, null, pool);
    const { rows } = await pool.query(
      'SELECT order_no, feature_id, note FROM golden_path WHERE owner_task_id=$1 ORDER BY order_no', [taskId]
    );
    expect(rows.length).toBe(2);
    expect(rows[0].feature_id).toBe(abilityId);
    expect(rows[0].note).toContain('发布');
  });

  it('二次触发幂等（覆盖写不叠加）', async () => {
    await promoteRegressionOnHarnessMerged(taskId, { merged: true }, null, pool);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM golden_path WHERE owner_task_id=$1', [taskId]);
    expect(rows[0].n).toBe(2);
  });

  it('line-context 新 SQL 能按 journey 读回累积 FR', async () => {
    const ctx = await fetchLineContext({ pool }, { journeyId });
    const mine = ctx.cumulativeFR.find((a) => a.owner_task_id === taskId);
    expect(mine).toBeTruthy();
    expect(mine.ability_id).toBe(abilityId);
    expect(mine.steps.length).toBe(2);
  });
});
```

注意：journeys/journey_features 的 NOT NULL 列以实际 schema 为准（先 `psql` 或看 migration 补必填列；本地跑不了就以 `golden-path.integration.test.js` 的夹具 INSERT 为模板抄列清单）。

- [ ] **Step 2: 本地能连 postgres 则跑；不能则至少 node --check**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/promote-regression.integration.test.js`（本地有 DB 时）
Expected: 3 用例 PASS。本地无 DB → `node --check` 过 + 交给 CI brain-integration job。

- [ ] **Step 3: commit**

```bash
git add packages/brain/src/__tests__/integration/promote-regression.integration.test.js
git commit -m "test(brain/T2): promote-regression 真 postgres 集成回归（merged→golden_path→line-context 读回）"
```

---

### Task 6: DevGate + 版本 bump + 收尾

**Files:**
- Modify: `packages/brain/package.json`（version minor bump）
- 可能：版本同步涉及的其他文件（以 check-version-sync.sh 输出为准）

- [ ] **Step 1: DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: facts-check 过；version-sync 若报不同步，按其提示 bump `packages/brain/package.json` minor（feat）并同步其它位置后重跑至过。

- [ ] **Step 2: 全量相关测试再跑一遍**

```bash
cd packages/brain && npx vitest run src/__tests__/harness-promote-regression.test.js src/__tests__/callback-postprocess-promote.test.js src/__tests__/harness-line-context.test.js src/__tests__/harness-line-context-wiring.test.js src/__tests__/callback-processor.test.js src/__tests__/callback-dev-serial.test.js
bash packages/brain/scripts/smoke/callback-postprocess-smoke.sh
```
Expected: 全 PASS / 全 ok。（不跑 brain 全量 vitest——环境级 OOM 在案，交 CI。）

- [ ] **Step 3: commit 版本 bump**

```bash
git add packages/brain/package.json
git commit -m "chore(brain): version bump for T2 累积FR通电"
```

---

## DoD（PR body 用）

- [ ] [BEHAVIOR] harness_initiative 任务 merged 终态触发 golden_path 覆盖写（dbOnly、幂等、fail-open）
  Test: tests/ packages/brain/src/__tests__/integration/promote-regression.integration.test.js
- [ ] [BEHAVIOR] promoteToRegression dbOnly=true 不执行 git/yaml 副作用
  Test: tests/ packages/brain/src/__tests__/harness-promote-regression.test.js
- [ ] [BEHAVIOR] 累积 FR 读端（line-context + golden-paths 端点）走 golden_path.feature_id 直连
  Test: tests/ packages/brain/src/__tests__/harness-line-context.test.js
- [ ] [BEHAVIOR] 共享管道反分叉棘轮守住 5 处接线（proven-to-fire：Step 3.2 亲见红）
  Test: manual:bash packages/brain/scripts/smoke/callback-postprocess-smoke.sh
- [ ] CI 全绿
