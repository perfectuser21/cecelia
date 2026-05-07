# Sprint PRD — 验证 PR #2816 fix（harness_initiative executor 状态回写）

## OKR 对齐

- **对应 KR**：免疫系统 KR — Harness Pipeline 可靠性（v5/M2 阶段）
- **当前进度**：因 Brain API 在本 worktree 不可达，未能直读 OKR 进度；按系统决策走向（PR #2814 W1+W3+W4 可靠性升级 → PR #2816 状态回写补漏）推断本 KR 处于"补漏阶段"
- **本次推进预期**：消除"harness_initiative 永久卡 in_progress → tick 30min 超时 → 重新派发 → 死循环"这一已知阻塞，使 Harness Pipeline 在 v5 流程下可被"端到端跑完一次并被 tick 视为终态"

## 背景

PR #2816 已合并（2026-05-07 01:46 UTC）。其修复的 Bug：`packages/brain/src/executor.js` 的 `harness_initiative` 分支在 `compiled.invoke()` 返回后**从不调用** `updateTaskStatus`，导致：

```
LangGraph 完成 → reportNode 写 initiative_runs → invoke() 返回 → executor 返回 { success: true } →
dispatcher 只做日志 → tasks.status 永远卡 in_progress → tick loop 30min 超时 → 重新派发 → 无限循环
```

修复后，三条路径（无错误 / `final.error` / `catch` 异常）均显式回写终态并统一返回 `{ success: true }`。

PR #2816 已带 4 项**静态断言**单测（读源码字符串匹配，不真跑 LangGraph）。**本 Sprint 的价值**：把验证从"代码长成正确形状"升级到"派发一个真实 harness_initiative 任务，看 tasks 表里它最终落到 completed/failed 而非 in_progress"——即从代码形状契约升级到运行时行为契约。

## Golden Path（核心场景）

**入口**：通过 Brain `POST /api/brain/tasks` 派发一个 `task_type=harness_initiative` 的任务（payload 为最小可走通 LangGraph 的 PRD/spec stub）

**经过**：
1. tick loop 拾取该任务 → executor 路由命中 `harness_initiative` 分支
2. executor 编译并 `await compiled.invoke(...)` 跑 Harness Full Graph（A+B+C）
3. invoke 返回（成功路径或 `final.error` 路径），executor 显式调 `updateTaskStatus(task.id, 'completed' | 'failed')`
4. executor 返回 `{ success: true }`，dispatcher 不再回退状态

**出口**：
- 在 tasks 表中，该任务的 `status` 已由 `in_progress` 流转到 `completed` 或 `failed`（**不可继续是 `in_progress`**）
- 该任务的 `updated_at` 与 LangGraph 收尾时间近似一致（早于 30min tick 超时阈值）
- tick loop 不再对该任务发起重试 / 不再触发 30min stale-task 强制 fail
- 若 LangGraph 正常完成，`initiative_runs` 表有对应 report 记录；若 LangGraph 抛错，executor catch 块同样把 status 写为 `failed`

## 边界情况

- **LangGraph 内部抛错**：executor 外层 try/catch 必须捕获，写入 `failed`，仍返回 `{ success: true }`（防止 dispatcher 把已终态任务回退为 `queued`）
- **`final.error` 非空但 invoke 未抛**：走 LangGraph 正常返回但携带错误信号路径，应被识别为 `failed`
- **`updateTaskStatus` 自身失败**（例如 DB 短暂不可达）：executor 应有第二层兜底，避免函数整体崩溃；至少日志可读
- **重复派发**（PR #2816 之前堆积的 in_progress 任务被重新拾起）：fix 落地后再次跑，仍应正常终态化，不能复发死循环
- **空状态**：当前没有积压 harness_initiative 任务时，验证需主动构造一条最小派发样本

## 范围限定

**在范围内**：
- executor.js `harness_initiative` 分支三条返回路径的运行时行为验证（不仅仅是源码字符串匹配）
- tasks 表 status 字段流转的端到端观测
- tick loop 不再对终态任务复派的观测
- catch 路径的真实触发（构造一个会让 invoke() 抛错的 stub）

**不在范围内**：
- 修改 executor.js 本身（PR #2816 已合并，本 Sprint 只验证不重写）
- LangGraph 内部各 node（plannerNode/proposerNode/...）的功能正确性
- 非 `harness_initiative` 路径的 executor 行为（其他 task_type 走 Docker spawn / Codex Bridge 回调路径，不在本次验证范围）
- `dispatch-now` 路由（同类风险点，learning doc 已记录留待后续）
- Brain API 的多实例 / 高并发场景

## 假设

- [ASSUMPTION: Brain 服务在 Sprint 执行环境（非当前 worktree）可达 `localhost:5221`；本 PRD 撰写时该端口在 worktree 内拒绝连接，但 Generator/Evaluator 阶段会在主仓库或 docker-compose 启动后跑]
- [ASSUMPTION: 派发一条 `harness_initiative` 任务可以走 Brain 公开 API `POST /api/brain/tasks`，无需 secret/signed payload]
- [ASSUMPTION: 存在或可造一个最小的 PRD/spec payload，使 Harness Full Graph 能 invoke 完成（即便结果质量低也行，本 Sprint 不验证内容质量）]
- [ASSUMPTION: 触发 catch 路径的方法是构造一个 invalid payload 让 `compileHarnessFullGraph()` 或某 node 抛错；如不可行则降级为 mock 注入]
- [ASSUMPTION: tasks 表的 `status` 枚举包含 `queued` / `in_progress` / `completed` / `failed`；与 PR #2816 commit message 描述一致]

## 预期受影响文件

- `packages/brain/src/executor.js`：**只读不改**——验证 PR #2816 已落地的三条回写分支
- `packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js`：现有静态断言单测，本 Sprint 期间需 100% 通过
- `packages/brain/src/task-updater.js`（或等价模块）：`updateTaskStatus` 实现，验证其调用链通到 DB
- `packages/brain/src/tick.js`：观察 tick loop 不再对已终态任务复派
- `packages/brain/src/workflows/harness-initiative.graph.js`：仅作为被调用方，不修改
- 可能新增：`packages/brain/src/__tests__/executor-harness-initiative-runtime.test.js`（运行时行为测试，非静态断言）—— Proposer 决定是否需要
- 可能新增：`scripts/verify-harness-status-writeback.sh`（端到端验证脚本，派发 → 等待 → 查 status）—— Proposer 决定

## journey_type: autonomous
## journey_type_reason: 路径只触及 packages/brain/ 内的 executor / tick / task-updater / DB，无 UI、无远端 agent 协议，由 tick loop 自动派发并自动终态化，属于 Brain 内部自治环路。
