# Harness GAN Loop → LangGraph + PostgresSaver 迁移设计

**日期**: 2026-04-22
**分支**: cp-0422100552-harness-gan-loop-to-langgraph
**Task**: 225ac725-d4c9-4081-8c03-d4d01805a734

## 背景

### 问题现象

2026-04-21 验证 Initiative `2303a935` (Harness v6 Reviewer alignment 真机闭环) 时：

- GAN 循环跑到 Round 11，Brain 进程被 launchd 重启（macOS 系统内存压力 / jetsam 杀）
- 重启后 `harness-initiative-runner` 只能从 Round 1 重跑 Planner
- 消耗约 103 分钟 Claude CLI 真机时间 + 估算 $30-50 tokens
- 每次 Brain 挂（6 小时内约 6 次）都丢整条 Initiative 进度

### 根因

`packages/brain/src/harness-gan-loop.js` 是 173 行的 `while (true)` 循环：

- `round` / `feedback` / `contractContent` 等所有状态是 JS 局部变量
- Brain 进程退出 = 栈帧销毁 = 状态全丢
- 无 DB 持久化、无中断恢复、无 thread_id 概念

### 本应采用的路径

2026-04-16 PR #2385 引入 `@langchain/langgraph` 骨架，明确目标："手写状态机的替代方案 + PostgresSaver 持久化续跑"。
2026-04-19 PR 接通 `PostgresSaver.fromConnString` + `setup()`，`checkpoints` 等 4 张表已建好，存有 728 行历史 checkpoint 证明机制工作。

但 2026-04-19 Harness v2 M2 另写 `harness-initiative-runner.js` + `harness-gan-loop.js`，绕开 LangGraph。executor.js 的 `harness_initiative` 分支走了新路径，LangGraph 路径仅保留给已废弃的 `harness_planner` task_type。

### 修复范围

本 Sprint 只处理 **Phase A GAN 循环**（proposer ↔ reviewer 对抗）。Phase B (harness_task 派发) 和 Phase C (final_e2e) 是一次性操作，不需要 checkpoint，本 Sprint 不动。

## 目标

用 LangGraph 2 节点 StateGraph 替代 `harness-gan-loop.js` 的 while 循环，通过 PostgresSaver 把每轮 propose/review 的状态持久化到 `checkpoints` 表，Brain 重启后能从最后一个节点续跑。

## 架构

### 模块边界

```
executor.js (harness_initiative 分支)
  └─ 构造 PostgresSaver.fromConnString(DATABASE_URL) + setup()
  └─ 调 runInitiative(task, { checkpointer })

harness-initiative-runner.js
  └─ runInitiative(task, opts)
      ├─ 1. Prep: 挂 worktree + GITHUB_TOKEN (一次性，无 checkpoint)
      ├─ 2. 调 Planner container (一次性，无 checkpoint)
      ├─ 3. parseTaskPlan (纯函数)
      ├─ 4. ⭐ runGanContractGraph({ ...opts, checkpointer })  ← 新入口
      ├─ 5. upsertTaskPlan (DB 事务)
      ├─ 6. INSERT initiative_contracts (APPROVED 版)
      └─ 7. INSERT initiative_runs (phase='B_task_loop')

harness-gan-graph.js (新建)
  ├─ buildGanContractGraph(executor, opts) → compiled app
  ├─ createGanContractNodes(executor, opts) → { proposer, reviewer }
  └─ runGanContractGraph(opts) → { contract_content, rounds, cost_usd }
```

### LangGraph 状态 Schema

```js
const GanContractState = Annotation.Root({
  prdContent: Annotation,           // 不变，始终是 Planner 产出的 PRD
  contractContent: Annotation,      // Proposer 每轮覆写
  feedback: Annotation,             // Reviewer REVISION 时产出
  round: Annotation({ default: 0 }),// Proposer 进入前 +1
  costUsd: Annotation({ default: 0 }),
  verdict: Annotation,              // 'APPROVED' | 'REVISION'
});
```

### 图结构

```
START → proposer → reviewer → [conditional]
                                 ├─ APPROVED → END
                                 └─ REVISION → proposer (回环)
```

- `proposer` 节点：调 Docker Claude CLI 跑 `/harness-contract-proposer` skill，更新 `contractContent` + `round` + `costUsd`
- `reviewer` 节点：调 Docker Claude CLI 跑 `/harness-contract-reviewer` skill，产出 `verdict` + `feedback` + 累加 `costUsd`
- 条件边用 `addConditionalEdges('reviewer', routerFn, { APPROVED: END, REVISION: 'proposer' })`
- 预算兜底：`costUsd > budgetCapUsd` 时 reviewer 节点 throw，LangGraph 停止
- 无轮次上限（沿袭 harness-gan-loop 行为，预算 cap 是硬保护）

### Checkpoint 机制

- 每个节点执行前后 LangGraph 把 state 序列化写入 `checkpoints` 表
- `thread_id = task.id`，同一 Initiative 复跑会命中同一 thread
- Brain 重启后 `app.stream(initialState, { configurable: { thread_id } })` 从最后一个 checkpoint 续跑
- MemorySaver fallback 仅供单元测试；生产强制走 PostgresSaver

### runGanContractGraph 接口

```js
async function runGanContractGraph(opts) {
  const {
    taskId, initiativeId, sprintDir, prdContent,
    executor,              // 必传，docker-executor
    worktreePath,          // 必传，挂载到容器
    githubToken,           // 必传，容器内 git 用
    budgetCapUsd = 10,
    checkpointer,          // PostgresSaver 实例；无则 MemorySaver（测试用）
    readContractFile,      // 测试注入，默认读 worktree
  } = opts;

  const app = buildGanContractGraph(executor, {
    sprintDir, initiativeId, worktreePath, githubToken,
    budgetCapUsd, readContractFile,
  });

  const finalState = await app.invoke(
    { prdContent, round: 0, costUsd: 0 },
    {
      configurable: { thread_id: taskId },
      ...(checkpointer ? { checkpointer } : {}),
      recursionLimit: 100,  // 对齐 harness-graph-runner
    },
  );

  return {
    contract_content: finalState.contractContent,
    rounds: finalState.round,
    cost_usd: finalState.costUsd,
  };
}
```

函数签名与 `runGanContractLoop` 返回形状完全一致，`harness-initiative-runner.js` 调用点只改 import 名。

## 组件

### 1. `harness-gan-graph.js`（新建，目标 ~120 行）

职责：
- 定义 `GanContractState` 注解
- 实现 `createGanContractNodes(executor, opts)` 返回 `{ proposer, reviewer }` 两个节点函数
- 实现 `buildGanContractGraph(executor, opts)` 组装 StateGraph + 条件边
- 实现 `runGanContractGraph(opts)` 给 runner 调用

依赖：
- `@langchain/langgraph` (StateGraph, Annotation, START, END, MemorySaver)
- `./harness-gan-loop.js` 里的 `extractVerdict` / `extractFeedback` / `buildProposerPrompt` / `buildReviewerPrompt`（先 import 复用，删 gan-loop 时再把这些搬进 graph.js）

### 2. `harness-initiative-runner.js`（改 1 处）

改动：
```diff
- import { runGanContractLoop } from './harness-gan-loop.js';
+ import { runGanContractGraph } from './harness-gan-graph.js';
```
```diff
- ganResult = await runGanContractLoop({
+ ganResult = await runGanContractGraph({
      taskId: task.id,
      initiativeId,
      sprintDir,
      prdContent,
      executor,
      worktreePath,
      githubToken,
      budgetCapUsd: budgetUsd,
+     checkpointer: opts.checkpointer,
    });
```

函数签名接受 `opts.checkpointer`，透传到 graph。

### 3. `executor.js`（改 harness_initiative 分支）

现状：
```js
if (task.task_type === 'harness_initiative') {
  const { runInitiative } = await import('./harness-initiative-runner.js');
  return await runInitiative(task);
}
```

改为：
```js
if (task.task_type === 'harness_initiative') {
  const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
  const checkpointer = PostgresSaver.fromConnString(
    process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
  );
  await checkpointer.setup();  // 幂等

  const { runInitiative } = await import('./harness-initiative-runner.js');
  return await runInitiative(task, { checkpointer });
}
```

复用 `harness_planner` 分支同一套构造逻辑（已验证过）。

### 4. `harness-gan-loop.js`（删）

把其中 `extractVerdict` / `extractFeedback` / `buildProposerPrompt` / `buildReviewerPrompt` 搬进 `harness-gan-graph.js`，然后整个文件删除。

### 5. 单元测试 `harness-gan-graph.test.js`（新建）

覆盖：
- APPROVED 路径：1 轮 reviewer 返回 APPROVED → END，`rounds=1`
- REVISION → APPROVED：3 轮循环，最后一轮 APPROVED
- 预算超支：`costUsd > budgetCapUsd` 抛 `gan_budget_exceeded`
- Proposer 失败：container exit_code != 0 抛 `proposer_failed`
- Reviewer 失败：同上
- Checkpoint 注入：用 MemorySaver 测试，断言每轮 state 正确流转

保留 `harness-gan-loop.test.js` 的同层覆盖率（迁移不降低测试质量）。

## 错误处理

- **Proposer/Reviewer container exit_code != 0**：节点函数抛异常，LangGraph 终止整个 invoke，外层 runInitiative 捕获后更新任务 status=failed
- **预算超支**：reviewer 节点检查 costUsd > budgetCapUsd 时 throw，状态已 checkpoint，下次人工处理
- **Brain 进程中断**：不需要显式处理，PostgresSaver 自动续跑
- **无效 verdict**（既不是 APPROVED 也不是 REVISION）：`extractVerdict` 回退 REVISION（沿用 gan-loop 行为），避免无限循环要靠 budgetCap
- **checkpoints 表连不上**：setup() 抛错由 executor.js 捕获，降级到 MemorySaver + 打告警（避免阻塞）

## 数据流

### 首次运行（无 checkpoint）

```
executor.js 收到 harness_initiative task
  → 构造 PostgresSaver + setup()
  → runInitiative({ checkpointer })
      → 1. prep worktree + git clone
      → 2. Planner container (3min)
      → 3. parseTaskPlan
      → 4. runGanContractGraph({ checkpointer, thread_id=task.id })
            ↓
         app.invoke(initialState)
            ├─ [checkpoint: entering proposer, round=1]
            ├─ proposer 节点: 跑 container, 返回 contractContent
            ├─ [checkpoint: proposer done, round=1]
            ├─ reviewer 节点: 跑 container, 返回 verdict=REVISION, feedback
            ├─ [checkpoint: reviewer done, verdict=REVISION]
            ├─ 条件边: REVISION → proposer
            ├─ [checkpoint: entering proposer, round=2]
            ... 循环 N 轮
            └─ verdict=APPROVED → END, return finalState
      → 5. upsertTaskPlan
      → 6. INSERT initiative_contracts
      → 7. INSERT initiative_runs
```

### Brain 重启续跑

```
Brain crash → launchd 重启 Brain (10s 后)
  → tick 重新派 task (startup-sync 清理 claimed_by)
  → executor.js 再次进 harness_initiative 分支
  → 构造 PostgresSaver（同一 DB）
  → runInitiative({ checkpointer })
      → 1-3. 重复 (幂等，worktree + PRD 已存在)
      → 4. runGanContractGraph({ checkpointer, thread_id=task.id })
            ↓
         app.invoke(initialState, { thread_id })
            ├─ PostgresSaver 查 checkpoints WHERE thread_id=task.id
            ├─ 找到最后一个 checkpoint (e.g. round=8, verdict=REVISION)
            ├─ 从 proposer 节点继续 (round=9)
            ... 而不是从 round=1
```

## 范围限定

**在范围内**：
- 新建 `harness-gan-graph.js` + 单元测试
- 改 `harness-initiative-runner.js` 调用点 + 接收 opts.checkpointer
- 改 `executor.js` harness_initiative 分支构造 PostgresSaver
- 删 `harness-gan-loop.js` + 其测试
- 搬动 4 个辅助函数到 graph.js

**不在范围内**：
- Phase B/C 的 LangGraph 化（未来独立 Sprint）
- Brain 整体 Docker 化（独立 Task）
- checkpoints 表 schema 改动（已建好）
- 内存压力修复（colima/OrbStack 切换另算）
- harness-graph.js 的 6 节点图重构（那是 harness_planner 老路径）

## 成功标准

- **SC-001**: `packages/brain/src/harness-gan-graph.js` 存在，export `runGanContractGraph`
- **SC-002**: `harness-gan-graph.test.js` 覆盖 5 个场景，全部通过
- **SC-003**: `harness-initiative-runner.js` 不再 import `harness-gan-loop.js`
- **SC-004**: `harness-gan-loop.js` 已删除
- **SC-005**: `executor.js` harness_initiative 分支构造 PostgresSaver 并注入
- **SC-006**: 手动重跑 Initiative `2303a935`，中途 `kill` Brain，launchd 重启后 GAN 从最后一轮续跑（人工验证 checkpoints 表有 task.id 的行，新 Brain 进程的 Docker spawn 日志显示 round > 1）

## 假设

- [ASSUMPTION: PostgresSaver.setup() 幂等，重复调用无副作用]（已在 learning doc 验证）
- [ASSUMPTION: checkpoints 表 schema 兼容当前 `@langchain/langgraph-checkpoint-postgres@^1.0.1`]（已在生产用 728 行数据验证）
- [ASSUMPTION: Brain 重启后 worktree 仍存在]（StartupRecovery 会清 stale worktree，需要检查条件；如被清则 prep 阶段重建，幂等）
- [ASSUMPTION: 同一 task.id 作 thread_id 语义和 v2 Initiative 生命周期匹配]（一个 Initiative 一次执行，无并发）

## 边界情况

- **checkpoint 读到但节点执行又失败**：LangGraph 事务性保证，只有节点成功才推进 checkpoint
- **thread_id 碰撞**：task.id UUID，碰撞概率忽略
- **DB 连接断 + 重连**：PostgresSaver 底层用 pg pool，与 Brain 其他代码共享，断连由 pg 驱动恢复
- **checkpointer.setup() 失败**：executor.js 捕获后降级 MemorySaver，打 P1 告警（暂不中止，让 Initiative 先跑）

## 预期受影响文件

```
packages/brain/src/harness-gan-graph.js                       (新建)
packages/brain/src/harness-initiative-runner.js               (2 处改)
packages/brain/src/executor.js                                (1 处改)
packages/brain/src/__tests__/harness-gan-graph.test.js        (新建)
packages/brain/src/harness-gan-loop.js                        (删)
packages/brain/src/__tests__/harness-gan-loop.test.js         (删，如存在)
docs/superpowers/specs/2026-04-22-harness-gan-loop-to-langgraph-design.md  (本文档)
docs/learnings/cp-0422100552-harness-gan-loop-to-langgraph.md (Ship 时写)
```
