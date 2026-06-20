# parseTaskPlan 钉死 1-PR + 清死函数 nextRunnableTask 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（本计划小且已全量勘探，inline 执行）。Steps use checkbox (`- [ ]`).

**Goal:** parseTaskPlan 从代码层硬保证 tasks.length===1（1 harness=1 sprint=1 PR），并清除无生产调用的死函数 nextRunnableTask 及其全部引用。

**Architecture:** 在 parseTaskPlan 的非空校验后插入 `!==1` 护栏（取代旧 `>8` cap）；删 nextRunnableTask 函数 + 头部 doc + dispatch-helpers 注释引用 + 死测试文件 harness-phase-advancer.test.js + 5 个 vi.mock 残留行。TDD 两次 commit。

**Tech Stack:** Node ESM, vitest。

---

## File Structure

- Modify `packages/brain/src/harness-dag.js` — 护栏 + 删 nextRunnableTask + 删头部 doc 第12行
- Modify `packages/brain/src/__tests__/harness-dag.test.js` — 加护栏正负测试 + 改 6 个多-task 用例
- Modify `packages/brain/src/dispatch-helpers.js:94,140` — 注释去掉对已删函数名的引用
- Modify 5 个 vi.mock 残留：`harness-subtask-verdict-passthrough.test.js` / `harness-report-self-merge-gate.test.js` / `harness-infertaskplan-terminal.test.js` / `harness-initiative-evaluate.test.js` / `harness-report-merge-recheck.test.js`
- Modify `select-next-task-dependencies-gate.test.js:10` — 注释去引用
- Delete `packages/brain/src/__tests__/harness-phase-advancer.test.js` — 整段 skip + import 已删除模块 `harness-phase-advancer.js` 的死文件（nextRunnableTask 引用主簇）

红线（不碰）：pick/run/advance 循环、task_loop_index、ws1/workstream_count 命名、detectCycle、topologicalOrder、upsertTaskPlan。

---

## Task 1：失败回归测试（commit-1 / Red）

**Files:** Modify `packages/brain/src/__tests__/harness-dag.test.js`

- [ ] **Step 1: 在 `describe('parseTaskPlan', ...)` 块内（line 89 之后）追加两个测试**

```js
  it('拒多 task（≥2）—— 1 harness=1 sprint=1 PR 硬约束', () => {
    const plan = makeValidPlan([
      makeValidTask('ws1'),
      makeValidTask('ws2', ['ws1']),
    ]);
    expect(() => parseTaskPlan(JSON.stringify(plan)))
      .toThrow(/!== 1/);
  });

  it('接受恰好 1 task', () => {
    const plan = makeValidPlan([makeValidTask('ws1')]);
    const out = parseTaskPlan(JSON.stringify(plan));
    expect(out.tasks).toHaveLength(1);
  });
```

- [ ] **Step 2: 跑测试确认第一个 RED**

Run: `cd /Users/administrator/worktrees/cecelia/harness-dag-pin-1pr && npx vitest run packages/brain/src/__tests__/harness-dag.test.js -t "拒多 task"`
Expected: FAIL（当前 2-task 合法通过，不抛 → toThrow 失败）。"接受恰好 1 task" 当前已 PASS。

- [ ] **Step 3: commit-1**

```bash
cd /Users/administrator/worktrees/cecelia/harness-dag-pin-1pr
git add packages/brain/src/__tests__/harness-dag.test.js
git commit -m "test(harness): parseTaskPlan 多task 应拒（1 harness=1 PR）— failing test"
```

---

## Task 2：实现护栏 + 删死代码 + 改受影响用例（commit-2 / Green）

**Files:** harness-dag.js / harness-dag.test.js / dispatch-helpers.js / 5 个 mock 文件 / 删 harness-phase-advancer.test.js

- [ ] **Step 1: harness-dag.js 替换护栏（当前第 74-79 行 `>8` cap 整块）**

把：
```js
  if (obj.tasks.length > 8) {
    throw new Error(`parseTaskPlan: tasks length ${obj.tasks.length} > 8 (hard cap)`);
  }
  if (obj.tasks.length > 8 && (!obj.justification || typeof obj.justification !== 'string' || !obj.justification.trim())) {
    throw new Error('parseTaskPlan: tasks.length > 8 requires non-empty justification');
  }
```
替换为：
```js
  // 1 harness = 1 sprint = 1 PR（workstream 拆分 v8.0.0 已废弃，对齐 Anthropic 官方 v2）。
  // 旧逻辑放行 ≤8 个 task 是 workstream 模型残留；现从代码层硬保证单 task，
  // 兜底 proposer LLM 漂移多写 task 直接跑出 N 个 PR。
  if (obj.tasks.length !== 1) {
    throw new Error(
      `parseTaskPlan: tasks length ${obj.tasks.length} !== 1 — 1 harness = 1 sprint = 1 PR（workstream 拆分 v8.0.0 已废弃）`
    );
  }
```
（第 71 行非空数组校验保留不动；其后逐 task / depends_on / detectCycle 校验全部保留。）

- [ ] **Step 2: harness-dag.js 删头部 doc 第 12 行**

删除：` *   - nextRunnableTask(initId)    — 返回依赖全部 completed 的下一个 pending task`

- [ ] **Step 3: harness-dag.js 删 nextRunnableTask 函数**

删除 `nextRunnableTask` 的整段 JSDoc（以 `/**` 起、含 `@returns {Promise<object|null>}`）+ `export async function nextRunnableTask(initiativeTaskId, opts = {}) { ... return rows[0] || null; }` 全函数体。

- [ ] **Step 4: dispatch-helpers.js:94,140 注释去引用**

把两处 `参考 harness-dag.js:nextRunnableTask` 改为描述 SQL 模式本身，例如：`NOT EXISTS + from_task_id 子查询（依赖全部 completed 才可跑）`，不再出现函数名。

- [ ] **Step 5: 删 5 个 vi.mock 残留行**

在以下文件的 `vi.mock('../harness-dag.js', () => ({ ... }))` 工厂里删掉 `nextRunnableTask: vi.fn()` 一项（保留其余 mock）：
`harness-subtask-verdict-passthrough.test.js` / `harness-report-self-merge-gate.test.js` / `harness-infertaskplan-terminal.test.js` / `harness-initiative-evaluate.test.js` / `harness-report-merge-recheck.test.js`。
并删 `select-next-task-dependencies-gate.test.js:10` 注释里的函数名引用（改为描述模式）。

- [ ] **Step 6: 删死测试文件**

```bash
cd /Users/administrator/worktrees/cecelia/harness-dag-pin-1pr
git rm packages/brain/src/__tests__/harness-phase-advancer.test.js
```
（该文件 `describe.skip` + `import('../harness-phase-advancer.js')` 模块已不存在，是 nextRunnableTask 引用主簇的死代码。）

- [ ] **Step 7: 改 harness-dag.test.js 中被护栏打红的 6 个多-task 用例**

- 删除 `'接受合法线性 DAG'`(line 90, 3 task 成功)、`'拒重复 task_id'`(line 158)、`'拒环依赖'`(line 167)、`'接受 6 tasks ...'`(line 183)、`'接受 8 tasks ...'`(line 190) 五个用例——其多-task 语义已被 Task 1 的 `'拒多 task（≥2）'` 统一覆盖（duplicate/跨task环 在 N=1 下不可达；detectCycle 算法仍由其独立 describe 覆盖）。
- 将 `'拒 >8 tasks 硬上限'`(line 176) 改为：
```js
  it('拒 9 tasks（多 task 一律拒）', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => makeValidTask(`ws${i + 1}`));
    const plan = { initiative_id: 'x', tasks };
    expect(() => parseTaskPlan(JSON.stringify(plan)))
      .toThrow(/!== 1/);
  });
```
- 保留不动：initiative_id 注入整组、`拒空 tasks`、`拒少字段`、`拒无效 complexity`、`拒 estimated_minutes 越界`、`拒自环`、`拒引用不存在`、`拒非字符串`、`拒无效 JSON`（均 1 task 或 0 task，行为不变）。

- [ ] **Step 8: 跑全 harness-dag 测试转绿**

Run: `cd /Users/administrator/worktrees/cecelia/harness-dag-pin-1pr && npx vitest run packages/brain/src/__tests__/harness-dag.test.js`
Expected: PASS（含新护栏正负例 + 保留用例）。

- [ ] **Step 9: 确认 nextRunnableTask 全仓零引用**

Run: `cd /Users/administrator/worktrees/cecelia/harness-dag-pin-1pr && grep -rn "nextRunnableTask" packages/brain/src/ || echo "ZERO refs ✅"`
Expected: ZERO refs ✅

- [ ] **Step 10: commit-2**

```bash
cd /Users/administrator/worktrees/cecelia/harness-dag-pin-1pr
git add -A
git commit -m "fix(harness): parseTaskPlan 硬约束 tasks.length===1（钉死 1 harness=1 PR）+ 删死函数 nextRunnableTask"
```

---

## Task 3：受影响测试全跑 + DevGate

- [ ] **Step 1: 跑所有真实调用 parseTaskPlan 的测试 + 5 个改过 mock 的测试**

Run: `cd /Users/administrator/worktrees/cecelia/harness-dag-pin-1pr && npx vitest run packages/brain/src/__tests__/harness-dag.test.js packages/brain/src/__tests__/harness-subtask-verdict-passthrough.test.js packages/brain/src/__tests__/harness-report-self-merge-gate.test.js packages/brain/src/__tests__/harness-infertaskplan-terminal.test.js packages/brain/src/__tests__/harness-initiative-evaluate.test.js packages/brain/src/__tests__/harness-report-merge-recheck.test.js packages/brain/src/__tests__/select-next-task-dependencies-gate.test.js`
Expected: 全 PASS。

- [ ] **Step 2: DevGate（改 Brain 代码必过）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-dag-pin-1pr
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全通过。check-version-sync 若提示 Brain 版本需 bump，按其指引 bump（见 version-management）后再提交。

- [ ] **Step 3: 若 DevGate 触发版本 bump，commit**

```bash
git add -A && git commit -m "chore(brain): version bump for parseTaskPlan guard"
```

---

## Self-Review

- Spec coverage：护栏（Task2 S1）✅ / 删 nextRunnableTask（Task2 S2-6, S9）✅ / 受影响测试（Task2 S7, Task3 S1）✅ / DevGate（Task3 S2）✅
- 红线：未触碰 pick/advance/task_loop_index/ws1 命名/detectCycle/topologicalOrder/upsertTaskPlan ✅
- 无占位符：所有 step 含确切代码/命令 ✅
