# Fix relay 假 completed + 区段A 双 spawn 排雷 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** skill-relay 任务 spawn 成功后不再被假标 completed（留 in_progress，完成态归 harness-report），并排除 resumeStalledHarnessDrivers 区段A 对 relay 的误判双 spawn。

**Architecture:** 两处小改：① executor.js harness_initiative 分支对 `result.ok && result.mode==='skill-relay'` 增加"留 in_progress"分支；② harness-watchdog.js 区段A SELECT 加 `payload->>'orchestrator' IS DISTINCT FROM 'skill-relay'` 排除。TDD：每处先 failing test 后实现，分开 commit。

**Tech Stack:** Node.js ESM、vitest（模块级 vi.mock + vi.resetModules + 动态 import 模式）。

**Worktree:** `/Users/administrator/worktrees/cecelia/fix-relay-fake-completed`，分支 `cp-0707094313-fix-relay-fake-completed`。所有命令在该 worktree 根执行。禁止任何 npm install/ci 类写命令（worktree 软链陷阱）。

**背景（给零上下文实现者）:** Brain 的 harness_initiative 任务走 skill-relay 模式时，`spawnSkillRelaySession()` 只负责 spawn 一个 detached docker session 然后立即返回 `{ok:true, mode:'skill-relay', containerId,...}`。调用方 `executor.js` 沿用 LangGraph 时代语义把 `ok===true` 当"整条 sprint 跑完"→ 立即 `updateTaskStatus('completed')`。这是假成功：session 才刚开始跑。任务留 in_progress 后，`harness-watchdog.js` 的区段A（每 5 分钟扫"A 阶段活动静默>20min"的任务翻回 queued 重跑）会误判 relay（relay 不写它检查的三个活性信号），导致双 spawn——所以两处必须同 PR 修。

---

### Task 1: executor.js relay 分支——spawn 成功留 in_progress（TDD）

**Files:**
- Modify: `packages/brain/src/executor.js:3283-3291`（harness_initiative 分支的 result 消费处）
- Test: `packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js`

- [ ] **Step 1: 写 failing test**

在 `harness-initiative-executor-writeback.test.js` 顶部 mock 区（`vi.mock('../events/taskEvents.js', ...)` 之后）加 harness-skill-relay 的 mock：

```js
const mockSpawnRelay = vi.hoisted(() => vi.fn());
vi.mock('../harness-skill-relay.js', () => ({
  spawnSkillRelaySession: (...args) => mockSpawnRelay(...args),
}));
```

在 `HARNESS_TASK` 常量之后加 relay 任务常量（必须带 `payload.orchestrator='skill-relay'` 才能过 executor.js:2894 的硬校验）：

```js
const RELAY_TASK = {
  ...HARNESS_TASK,
  id: 'ccccdddd-1234-5678-9012-abcdef012345',
  payload: { ...HARNESS_TASK.payload, orchestrator: 'skill-relay' },
};
```

文件末尾新增 describe 块：

```js
describe('triggerCeceliaRun — skill-relay spawn 语义（Issue df107724）', () => {
  it('relay spawn 成功（ok=true, mode=skill-relay）→ 不得标 completed/failed，留 in_progress', async () => {
    mockSpawnRelay.mockResolvedValue({ ok: true, mode: 'skill-relay', containerId: 'cecelia-relay-test-1' });
    const result = await triggerCeceliaRun(RELAY_TASK);
    expect(result.success).toBe(true);
    expect(mockSpawnRelay).toHaveBeenCalledTimes(1);
    const statuses = mockUpdateTaskStatus.mock.calls.map((c) => c[1]);
    expect(statuses).not.toContain('completed');
    expect(statuses).not.toContain('failed');
  });

  it('relay spawn 失败（ok=false）→ 照旧标 failed（既有行为守护）', async () => {
    mockSpawnRelay.mockResolvedValue({ ok: false, mode: 'skill-relay', error: 'docker run failed' });
    await triggerCeceliaRun(RELAY_TASK);
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
      RELAY_TASK.id,
      'failed',
      expect.objectContaining({ error_message: expect.any(String) })
    );
  });
});
```

注意：`mockSpawnRelay` 也要进 beforeEach 的重置（现有 beforeEach 已有 `vi.clearAllMocks()`，无需额外处理；不要给 mockSpawnRelay 设全局默认返回值，两个用例各自 mockResolvedValue）。

- [ ] **Step 2: 跑测试确认第一个用例红**

Run: `cd /Users/administrator/worktrees/cecelia/fix-relay-fake-completed && npx vitest run packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js`
Expected: 新用例 1 FAIL（statuses 含 'completed'——当前代码 spawn 成功即标 completed）；用例 2 PASS（既有行为）；其余既有用例全 PASS。

- [ ] **Step 3: commit-1（红测试）**

```bash
git add packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js
git commit -m "test(brain): relay spawn 成功不得标 completed——failing regression test (Issue df107724)"
```

- [ ] **Step 4: 实现最小修复**

`packages/brain/src/executor.js`，把 harness_initiative 分支中：

```js
      if (result.ok === null) {
        console.log(`[executor] harness graph interrupted/waiting task=${task.id} thread=${result.threadId}, leaving in_progress`);
      } else if (result.ok) {
        await updateTaskStatus(task.id, 'completed');
```

改为：

```js
      if (result.ok === null) {
        console.log(`[executor] harness graph interrupted/waiting task=${task.id} thread=${result.threadId}, leaving in_progress`);
      } else if (result.ok && result.mode === 'skill-relay') {
        // relay 的 ok=true 只代表 session spawn 成功（detached 在跑），不是 sprint 跑完。
        // 完成态由 controller 末端 harness-report 回写（双保险：relay-watchdog 见容器消失
        // 且 PR MERGED → completed）。此处标 completed 会让 relay-watchdog house-keeping
        // 把在跑 run 收敛成 done，保护网失效（Issue df107724）。
        console.log(`[executor] skill-relay session spawned task=${task.id} container=${result.containerId}, leaving in_progress`);
      } else if (result.ok) {
        await updateTaskStatus(task.id, 'completed');
```

其余分支（ok:false → failed、catch → failed、return 对象）一字不动。

- [ ] **Step 5: 跑测试确认全绿（含兄弟形状测试）**

Run: `npx vitest run packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js`
Expected: 全 PASS。注意第二个文件是代码形状断言（`task.task_type === 'harness_initiative'` 起 2000 字符内须出现 `updateTaskStatus(task.id, 'completed'`）——新注释若过长会挤出窗口，失败则精简注释。

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/executor.js
git commit -m "fix(brain): relay spawn 成功留 in_progress，完成态归 harness-report (Issue df107724)"
```

---

### Task 2: harness-watchdog 区段A 排除 skill-relay（TDD）

**Files:**
- Modify: `packages/brain/src/harness-watchdog.js:200-225`（stalledA 的 SELECT）
- Test: `packages/brain/src/__tests__/harness-watchdog-gan-stall.test.js`

背景：区段A 判"活性信号静默>20min"用的三个信号（driver_heartbeat_at / initiative_runs.updated_at / initiative_run_events.ts）relay 链全都不写；relay spawn 落的 run 行 phase='A_planning' 恰好命中区段A 的 EXISTS。Task 1 修复后任务留 in_progress，20 分钟后区段A 会把活着的 relay session 翻回 queued → dispatcher 重 claim → 双 spawn。区段B 无需改（其 EXISTS 要求 phase='B_task_loop'，relay 链不产生该 phase）；区段C 不排除（relay spawn 失败无 run 行时，被区段C 捞回 queued 正是想要的兜底）。

- [ ] **Step 1: 写 failing test**

在 `harness-watchdog-gan-stall.test.js` 的 describe 内追加（沿用文件已有的 `findPhaseASelect()` helper 与 OPTS）：

```js
  it('phase A 查询排除 skill-relay 任务（relay 不写活性信号，误判会双 spawn，Issue df107724）', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers(OPTS);
    const sqlA = findPhaseASelect();
    expect(sqlA).not.toBe('');
    expect(sqlA).toMatch(/orchestrator'\s+IS\s+DISTINCT\s+FROM\s+'skill-relay'/i);
  });
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx vitest run packages/brain/src/__tests__/harness-watchdog-gan-stall.test.js`
Expected: 新用例 FAIL（当前 SQL 无排除子句），其余 PASS。

- [ ] **Step 3: commit-1（红测试）**

```bash
git add packages/brain/src/__tests__/harness-watchdog-gan-stall.test.js
git commit -m "test(brain): 区段A 须排除 skill-relay——failing test（防误判双 spawn）"
```

- [ ] **Step 4: 实现**

`packages/brain/src/harness-watchdog.js` stalledA 的 SELECT，在 `AND COALESCE(t.execution_attempts, 0) < $2::int` 之后插入一行：

```sql
        AND t.payload->>'orchestrator' IS DISTINCT FROM 'skill-relay'
```

（对齐 harness-initiative-patrol.js:195 的 v2 排除先例；区段B/C 不动，理由见本 Task 背景段，在区段A 该行上方加一行注释：`-- skill-relay 不写下方三个活性信号，静默≠卡死；其兜底归 harness-relay-watchdog（docker ps 存活 + PR 核验）`。注意 SQL 内注释用 `--` 会进模板字符串没问题，但保持与文件现有风格一致——现有 SQL 无行内注释则把说明写成 JS 注释放 query 语句上方。）

- [ ] **Step 5: 跑测试确认全绿**

Run: `npx vitest run packages/brain/src/__tests__/harness-watchdog-gan-stall.test.js packages/brain/src/__tests__/harness-watchdog.test.js packages/brain/src/__tests__/harness-watchdog-never-started.test.js packages/brain/src/__tests__/harness-watchdog-loop.test.js`
Expected: 全 PASS。

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/harness-watchdog.js
git commit -m "fix(brain): 区段A 排除 skill-relay 任务，防 relay 留 in_progress 后被误判 stuck 双 spawn"
```

---

### Task 3: 版本 bump + DevGate + 相关测试面全跑

**Files:**
- Modify: `packages/brain/package.json`（version patch +1）
- Modify: `package-lock.json`（根 lock 内 packages/brain 的两处 version——手工编辑，禁 npm install）

- [ ] **Step 1: bump 版本**

```bash
node -e "const f='packages/brain/package.json';const j=require('./'+f);console.log('当前版本:',j.version)"
```

把 `packages/brain/package.json` 的 `version` patch 位 +1（如 x.y.z → x.y.z+1）。然后在根 `package-lock.json` 里 grep 旧版本号定位 packages/brain 相关的两处（`"packages/brain"` 节点的 `version` 和 `node_modules/@cecelia/brain` 若存在），同步改为新版本。

- [ ] **Step 2: DevGate 三连**

```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三个全部通过。任何一个失败 → 按其输出修正（facts-check 失败常见于 DEFINITION.md 与代码漂移——本 fix 不改 PORT/TICK/whitelist，不应触发；version-sync 失败=lock 两处漏改）。

- [ ] **Step 3: 相关测试面全跑（守卫组防漏跑）**

```bash
npx vitest run packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js \
  packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js \
  packages/brain/src/__tests__/harness-watchdog-gan-stall.test.js \
  packages/brain/src/__tests__/harness-watchdog.test.js \
  packages/brain/src/__tests__/harness-watchdog-never-started.test.js \
  packages/brain/src/__tests__/harness-watchdog-loop.test.js \
  packages/brain/src/__tests__/harness-skill-relay.test.js \
  packages/brain/src/__tests__/harness-relay-watchdog.test.js \
  packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js \
  packages/brain/src/__tests__/relay-v101.test.js
```
Expected: 全 PASS。

- [ ] **Step 4: commit**

```bash
git add packages/brain/package.json package-lock.json
git commit -m "chore(brain): version bump for relay fake-completed fix"
```

---

### PR 交接信息（finishing 阶段用）

PR 标题：`fix(brain): skill-relay spawn 成功误标 completed + 区段A 双 spawn 排雷 (Issue df107724)`

PR body DoD（全部勾 [x] 后才 push）：

```markdown
## DoD
- [x] [BEHAVIOR] relay spawn 成功（ok=true, mode=skill-relay）任务留 in_progress，不再假标 completed。Test: packages/brain/src/__tests__/harness-initiative-executor-writeback.test.js（describe: skill-relay spawn 语义）
- [x] [BEHAVIOR] resumeStalledHarnessDrivers 区段A SELECT 排除 skill-relay 任务。Test: packages/brain/src/__tests__/harness-watchdog-gan-stall.test.js（phase A 查询排除 skill-relay）
- [x] [BEHAVIOR] relay spawn 失败仍标 failed（回归守护）。Test: 同 writeback 测试文件用例 2
- [x] commit 顺序：test 红先 commit，实现后 commit（TDD，lint-tdd-commit-order 可核）

关联：Notion Issue df107724（P1）/ 14a7267e（P2 后续）；Brain task e588ba5a；decisions e44edbfc
部署提示：merge 后 Gate3 自动重部署生产；生效必须重建镜像（brain-deploy.sh），reload 不够。
```

---

## Self-Review 记录

- Spec 覆盖：设计文档两处修复（executor 分支 / 区段A 排除）→ Task 1 / Task 2；测试策略三条 → Task 1 Step 1（两用例）+ Task 2 Step 1；非目标（deadline 兜底）已登记 Issue 14a7267e 不在本计划 ✓
- 无占位符：所有代码/命令/预期输出均为实文 ✓
- 一致性：mock 名 mockSpawnRelay、常量 RELAY_TASK、排除子句写法在各 Task 间一致；区段B/C 不改的理由已写明 ✓
