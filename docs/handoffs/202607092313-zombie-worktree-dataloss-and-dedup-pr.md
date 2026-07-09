# Handoff：zombie-sweep 未提交改动误删 worktree（真实数据丢失，未修）+ task-dedup-guard PR 收尾

task_id: unknown（跨多个子任务的会话级 handoff）
verdict: 部分 PASS（dedup PR 待 CI）+ 一个 P0 级未修 bug（本 handoff 的核心）

## 🔴 最优先：zombie-sweep.js / zombie-cleaner.js 删 worktree 前不检查未提交改动（真实丢过一次数据，未修）

### 症状（今天实测复现，不是猜测）

在 `/Users/administrator/worktrees/cecelia/task-dedup-guard` 这个手动建的 worktree 里写了 4 个测试文件的手动修复（未提交），大约 30 分钟后，整个目录从文件系统上消失（`ls` 报 no such file/directory），`git worktree list` 也不再显示它。未提交的修复全部丢失（好在之前已 push 的代码没丢，只丢了最后一轮手动修复，已经重做并推送，见下方"已完成"）。

### 根因（已用代码 + 复现验证确认）

`packages/brain/src/` 下有 **三套独立**的孤儿 worktree 清理机制，安全等级不一致：

1. `cleanup-worker-plugin.js`（调 `scripts/cleanup-merged-worktrees.sh`）—— **安全**，有 5 道 Guard，第一条就是"无 uncommitted"（`git status --porcelain` 检查）。
2. `zombie-cleaner.js::cleanupOrphanWorktrees()`（`tick-runner.js` 每 20 分钟触发）—— **不安全**：只查目录 mtime 年龄（30分钟）+ `.dev-mode*` 文件 mtime（24h 内算活跃）+ DB `status='in_progress'` 任务是否对应，**全程没有一行 `git status` 检查**。
3. `zombie-sweep.js::sweepStaleWorktrees()`（`tick-runner.js` 每 30 分钟触发）—— **不安全**：30 分钟宽限期（按 `birthtimeMs`），Channel 1 查 `payload.branch` 是否在 `in_progress` 任务里，Channel 2 查 `.dev-mode` UUID + mtime，**同样全程没有 `git status` 检查**。

我这次的 worktree 撞上 #3 的原因：
- 是手动通过 `worktree-manage.sh init-or-check` 建的（不是 `session-*` 命名格式），没有心跳进程持续 touch `.dev-mode.cp-*` 文件的 mtime
- 我 `claim` 了 Brain task（`POST /tasks/:id/claim`），但 **claim 只设置 `claimed_by`，不会把 `status` 从 `queued` 转成 `in_progress`**——今天 Phase 0 加的 claim 端点就是这个语义。所以 DB 里这个任务永远不在 `status='in_progress'` 集合里，`zombie-sweep` 的两条"有没有活跃任务"检查全部失效
- 30 分钟一到，`git worktree remove --force` 直接执行，完全不管里面有没有未提交改动

### 关键代码位置（下一步要改的地方）

- `packages/brain/src/zombie-sweep.js`：`sweepStaleWorktrees()` 函数，第149-205行左右，在"Channel 2"判断之后、`execSync('git worktree remove --force ...')`（约第187行）之前，需要加一道 `git -C <wt.path> status --porcelain` 检查，非空则 skip（照抄 `scripts/cleanup-merged-worktrees.sh` 的 Guard A 模式）
- `packages/brain/src/zombie-cleaner.js`：`cleanupOrphanWorktrees()` 函数，第153-245行左右，同样在 `execSync('git worktree remove --force ...')`（约第237行）之前加同样的检查
- 参考实现：`scripts/cleanup-merged-worktrees.sh` 的 Guard A（已经是对的，抄它的判断逻辑）

### 建议 PrepPRD 方向（下一个 session 走 `/dev` 路径 A，这是个真实 bug）

**症状**：手动创建的功能分支 worktree（非 `session-*`）如果超过 30 分钟没有活跃心跳信号，即使内部有未提交的修改，也会被 `zombie-sweep`/`zombie-cleaner` 静默强制删除，造成不可恢复的工作丢失。

**根因**：见上方。

**修法**：在两个清理函数里，`execSync('git worktree remove --force ...')` 之前，加：
```js
const gitStatus = execSync(`git -C "${wtPath}" status --porcelain`, { encoding: 'utf8' }).trim();
if (gitStatus) {
  console.log(`[zombie-sweep] Skip ${wtPath}: 有未提交改动，不删`);
  result.skipped++;
  continue;
}
```
两个文件都要加（不要只修一个，另一个同样有洞）。

**Regression Test 计划**：造一个临时 git 仓库 + worktree，写入未提交改动，手动把 worktree 目录 birthtime 改老（或 mock `Date.now()`/`statSync`），调用 `sweepStaleWorktrees()`/`cleanupOrphanWorktrees()`，断言 worktree **没有**被删除、`result.skipped` 计数增加。这是逻辑接缝，CI unit test 覆盖即可。

**这是今天最值得优先修的一个真实数据丢失风险**——不是"看起来危险"，是我今天亲身丢过一次工作。

---

## 已完成：task-tasks.js POST /tasks 服务端去重护栏（issue 655691d2 的修复）

背景见 `docs/handoffs/202607092210-concurrency-audit-and-fixes.md`（更早的一份 handoff，讲清楚了今天一整天"并发撞车"系列问题的来龙去脉，包括 issue `655691d2` 的根因）。

### 当前状态

分支 `cp-0709223506-task-dedup-guard`，PR **#3688**（open，等 CI）。

代码本体（`task-tasks.js` 加去重 SELECT）已经合并到分支并推送，CI 第一轮跑出 3 个真实回归（不是 flaky）：

1. `sprints/07070902-relay-codex-executor/tests/contract-executor-validation.test.ts` —— mock 用 `mockResolvedValue`（永久性）导致去重 SELECT 也读到假的"已存在任务"数据，7 个测试里 3 个失败
2. `packages/brain/src/__tests__/tasks-schema-normalize.test.js` —— 同样问题，8 个测试受影响
3. `packages/brain/src/__tests__/routes/task-tasks.test.js`（注意：跟 `packages/brain/src/routes/__tests__/task-tasks.test.js` 是两个不同目录下的同名文件！）—— 10 个 POST 相关测试受影响
4. `packages/brain/src/__tests__/integration/brain-endpoint-contracts.test.js` —— 1 个测试受影响

**根因**：这 4 个文件都是"姐妹测试文件"（mock 了 `pool.query`，跟着测同一个 `task-tasks.js` 路由），去重逻辑让每次 `POST /tasks` 从 1 次 `pool.query` 调用变成 2 次（先 SELECT 去重再 INSERT），所有假设"只调用一次"的 mock 序列都需要补一个 dedup-miss（`{rows:[]}`）在前面，INSERT 相关的 `mock.calls[0]` 断言下标要移到 `[1]`。

**已修**：4 个文件全部修好，commit `793fc316b`（`test(brain): 修复C3去重护栏引入的4个姐妹测试文件回归`），已推送到远程分支。本地验证 5 个受影响文件共 63 个测试全部通过。

**⚠️ 还没验证的地方**：
- 只搜过 `packages/brain/src/routes/task-tasks.js`（不带引号）和 `routes/task-tasks` 关键词，理论上可能还有第 5、6 个没搜到的姐妹文件——如果 CI 再跑出新的类似失败，按同一个模式修（补 `{rows:[]}` + 挪 `calls[]` 下标）
- PR CI 还没跑完，没看到这轮修复后的最终结果，下一个 session 接手时第一件事应该是 `gh pr checks 3688 --repo perfectuser21/cecelia` 看状态

### 一个意外发现（顺带确认，不需要行动）

跑集成测试时发现数据库里**已经有一个叫 `idx_tasks_dedup_active` 的唯一索引**（migration `077_tasks_dedup_index.sql`，很老的迁移），逻辑跟我这次加的应用层去重几乎一样（title + goal_id/project_id + status IN queued/in_progress）。这解释了为什么历史上的重复任务都是"标题稍有不同"才漏网——精确匹配的 DB 约束早就在拦精确重复了，只是应用层没有优雅处理这个约束冲突（会抛 500 而不是返回 200+deduplicated）。**这次的应用层去重跟这个已有索引不冲突，是互补的**（应用层拦大部分场景+给出友好响应，DB 层兜底防亚秒级竞态）——不需要额外处理，只是记录一下这个背景，避免下个 session 看到 `idx_tasks_dedup_active` 报错以为是新 bug。

---

## 数据源

- 更早的 handoff（今天完整的并发问题排查历史）：`docs/handoffs/202607092210-concurrency-audit-and-fixes.md`
- issue：`655691d2-df1f-413f-a760-5cce0f4dd097`（P1，In progress，这次 PR 是它的修复）
- PR：#3688（open，cecelia repo，`cp-0709223506-task-dedup-guard` 分支）
- Brain task：`3361a7b2-ceff-45ad-8156-a2e9e0adea8f`
- decision：`e01cb167-2846-4281-ab83-c5d8645a1728`（去重护栏方案）
- 关键代码：
  - `packages/brain/src/routes/task-tasks.js`（已改，去重 SELECT）
  - `packages/brain/src/zombie-sweep.js`（**待改**，P0 数据丢失 bug）
  - `packages/brain/src/zombie-cleaner.js`（**待改**，同一个 bug 的另一处）
  - `scripts/cleanup-merged-worktrees.sh`（参考实现，Guard A 已经是对的）

## Worktree 现状

`/Users/administrator/worktrees/cecelia/task-dedup-guard-2`（原来的 `task-dedup-guard` 已被删，这是重建的第二份，注意路径带 `-2` 后缀）。**这个 worktree 本身也一样脆弱**——同样的机制没修，它也可能在 30 分钟不活跃后被删。下一个 session 如果要继续用它，要么尽快让对应 Brain task 转成真正的 `in_progress`（而不是只 claim），要么尽快提交推送，不要留太久的未提交状态。

## 下一步（建议优先级）

1. **P0：修 zombie-sweep.js + zombie-cleaner.js 的未提交改动检查缺失**（本 handoff 的核心发现，走 `/dev` 路径 A）
2. **P1：盯 PR #3688 CI，确认这轮姐妹测试修复后全绿，推进合并**
3. 完成后本任务（issue 655691d2）才算真正收尾
