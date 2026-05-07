# Sprint PRD — 验证 PR #2816：harness_initiative 完成后 status 自动回写

## OKR 对齐

- **对应 KR**：KR-免疫系统（harness pipeline 可靠性，executor 状态机正确性）
- **当前进度**：[ASSUMPTION: ~60%，executor 已具备主路径，缺正向验证 status 回写在端到端真实运行场景成立]
- **本次推进预期**：+5%（把单元测试覆盖的 status 回写行为，升级为端到端可观测的真实运行验证）

## 背景

PR #2816（已合并 2026-05-07T01:46Z）修了一个真实卡顿 bug：`packages/brain/src/executor.js` 处理 `harness_initiative` 任务时，调用 `compiled.invoke()` 后从未调用 `updateTaskStatus`，导致任务执行完毕仍卡在 `in_progress`，后续 dispatcher 看到状态不变会再次拉起，造成重复执行 / OKR 进度无法收敛。

修复路径：`compiled.invoke()` 返回后根据 `final.error` 写 `completed` 或 `failed`；外层 catch 也写 `failed`；返回值统一 `{ success: true }`，防止 dispatcher 把已完成任务回退 `queued`。

PR 自带 4 项静态断言测试（`executor-harness-initiative-status-writeback.test.js`），但**单元测试只能保证代码路径里调用了 `updateTaskStatus`，无法证明在真实 Brain runtime 中数据库行被实际更新**。本 Sprint 的目标是闭合这一信任缺口：跑一个真实的 `harness_initiative` 任务，观察数据库 `tasks.status` 从 `in_progress` 终态变为 `completed`（或 `failed`），且不再卡住。

## Golden Path（核心场景）

主理人/Brain 派发一个 `harness_initiative` task → executor 调度 LangGraph 子图执行完毕 → executor 回写 `tasks.status = completed` → dispatcher 不再重复拉起这条任务。

具体：
1. **触发条件**：本 Initiative 自身就是一个 `harness_initiative` 任务（task_id = `84075973-99a4-4a0d-9a29-4f0cd8b642f5`）。它的整段 harness pipeline（planner → proposer → reviewer → generator → evaluator → report）跑完，就是一次真实端到端样本。
2. **系统处理**：
   - executor 进入 harness_initiative 分支，调用 `compiled.invoke()`；
   - 子图各阶段全部 PASS（或 FAIL）后返回 `final`；
   - executor 根据 `final.error` 调 `updateTaskStatus(task.id, 'completed' | 'failed')`；
   - 任意阶段抛异常时，外层 catch 调 `updateTaskStatus(task.id, 'failed')`；
   - executor 返回 `{ success: true }`。
3. **可观测结果**：
   - 数据库行 `tasks WHERE id = '84075973-99a4-4a0d-9a29-4f0cd8b642f5'` 的 `status` 字段最终值 ∈ `{completed, failed}`，**不是** `in_progress` 或 `queued`；
   - `updated_at` 晚于 `started_at`；
   - dispatcher 日志中没有针对该 task_id 的"重复拉起 / status 不变 reschedule"记录；
   - 同时跑一遍 PR #2816 自带的 `executor-harness-initiative-status-writeback.test.js`，4 项静态断言全部 PASS（守护单元层不退化）。

## 边界情况

- **harness 子图中途某阶段 FAIL**（e.g. evaluator 判定不通过）：executor 仍必须把 `tasks.status` 写 `failed`，不能停留 `in_progress`。
- **executor 内部抛异常**（数据库连接闪断、JSON parse 失败等）：catch 分支必须把 `tasks.status` 写 `failed`，并且整个 executor 调用返回 `{ success: true }`，避免 dispatcher 把任务回退 `queued` 后再次拉起一个已经爆炸的任务。
- **同一 task_id 并发执行**：本 PR 不解决并发去重（属于已知遗留），只要单实例执行后状态正确即可。
- **空状态**：若 `compiled.invoke()` 返回 `final` 为空对象（无 error 字段），按"无 error = 成功"处理，写 `completed`。

## 范围限定

**在范围内**：
- 端到端运行一次真实 `harness_initiative` 任务，断言 DB `tasks.status` 终态正确；
- 复跑 PR #2816 自带的单元测试，确认未退化；
- 检查 dispatcher 日志，确认没有重复拉起。

**不在范围内**：
- 修改 executor.js 本身（PR #2816 已合并，本 Sprint 只验证不改实现）；
- 重构 harness pipeline 的其他阶段；
- 解决并发执行去重问题；
- 给 dispatcher 加新的状态机；
- 性能 / 资源消耗优化。

## 假设

- [ASSUMPTION: 当前 main 分支已包含 PR #2816 的合并（mergedAt = 2026-05-07T01:46Z），本 Sprint 在 main 之后的分支上跑]
- [ASSUMPTION: Brain runtime 在验证环境中可启动并连得上 PostgreSQL `cecelia` 库]
- [ASSUMPTION: harness pipeline 各阶段在当前代码 base 上能跑完一次（不强求所有阶段都返回 PASS，只要能终态化即可，FAIL 也算闭环）]
- [ASSUMPTION: KR-免疫系统的"当前进度 ~60%" 是凭已合并 PR 序列估计，Brain API 不可达时无法精确取数]

## 预期受影响文件

- `packages/brain/src/executor.js`：验证目标，**本 Sprint 不修改**，仅观察其行为。
- `packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js`：复跑断言不退化。
- `sprints/golden-path-verify-20260507/`：本 Sprint 产出的 PRD / 合同 / 报告归档目录。
- 数据库 `tasks` 表（行 `id = 84075973-99a4-4a0d-9a29-4f0cd8b642f5`）：观察终态字段，不直接改写。

## journey_type: autonomous
## journey_type_reason: 改动只涉及 packages/brain/src/executor.js 的 runtime 状态回写行为，无 UI、无 dev-pipeline hooks/skills、无远端 agent 协议变化，纯 Brain 自动运行链路。
