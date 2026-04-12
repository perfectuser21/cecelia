# Sprint PRD — Harness Pipeline 完整闭环（Phase 4/5 补全 + Stop Hook 修复）

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 85%
- **说明**：Harness Pipeline 是 Cecelia 自动化开发闭环的核心组件。Phase 4/5 断链导致每次 harness 任务都需要人工介入 CI 监控和合并后收尾，与"管家闭环"KR 直接矛盾

## 背景

Harness Pipeline 当前实现了 Phase 1-3（Planner → GAN 对抗 → Generator 执行），但 Generator 完成 push 后流程断裂：仅做一次 CI 状态查询就直接生成 report，没有持续监控 CI 结果、没有自动合并、没有合并后收尾。这导致每次 harness 执行都在"最后一公里"断链，需要人工完成 CI 等待、PR 合并、worktree 清理、Brain 任务回写等收尾工作。

此外，stop.sh 在检测活跃开发锁时，会误判已删除 worktree 的残留分支名为活跃状态，阻止正常退出。

## 目标

让 Harness Pipeline 在 Generator push 后自动完成 CI 监控 → 自动合并 → 收尾清理 → 生成报告的全链路闭环，消除人工介入。

## User Stories

**US-001**（P0）: 作为 Cecelia 系统，我希望 Generator 完成后自动创建 CI 监控任务并轮询等待 CI 通过，以便不再需要人工检查 CI 状态

**US-002**（P0）: 作为 Cecelia 系统，我希望所有 WorkStream PR 合并后有统一的收尾环节，以便自动完成 contract 校验、worktree 清理、Brain 状态回写和最终报告生成

**US-003**（P1）: 作为开发者，我希望 stop.sh 不再因已删除 worktree 的残留分支而误阻退出，以便正常结束开发会话

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）:
- **Given** Generator 已完成代码生成并 push 到远端
- **When** Generator 阶段结束
- **Then** 系统自动创建 harness_ci_watch 任务，持续轮询 CI 状态直到 CI 完成（通过或失败）

**场景 2**（关联 US-001）:
- **Given** harness_ci_watch 检测到 CI 全部通过
- **When** CI 状态变为 success
- **Then** 系统自动执行 PR 合并（auto-merge）

**场景 3**（关联 US-001）:
- **Given** harness_ci_watch 检测到 CI 失败
- **When** CI 状态变为 failure
- **Then** 系统记录失败原因，不执行合并，将失败信息传递给后续报告阶段

**场景 4**（关联 US-002）:
- **Given** 一个 sprint 包含多个 WorkStream，所有 WS 的 PR 都已合并
- **When** 最后一个 WS 合并完成
- **Then** 系统创建 harness_post_merge 任务，依次执行：(a) 整体 contract 达标校验 (b) 清理所有 WS 的 worktree 和临时分支 (c) 回写 Brain 任务状态和 OKR 进度 (d) 创建 harness_report

**场景 5**（关联 US-002）:
- **Given** 多个 WS 中部分合并成功、部分失败
- **When** post_merge 执行时
- **Then** 报告中清晰标注每个 WS 的状态（成功/失败/跳过），仅对成功的 WS 执行清理

**场景 6**（关联 US-003）:
- **Given** 某个 worktree 目录已被删除，但 git 分支记录仍残留
- **When** stop.sh 执行活跃开发锁检测
- **Then** stop.sh 仅检测实际存在的 worktree 目录中的 .dev-lock 文件，忽略已删除 worktree 的残留分支

## 功能需求

- **FR-001**: Generator 完成后，在 execution.js 中创建 harness_ci_watch 子任务（而非一次性查询 CI），调用 harness-watcher.js 已有的轮询逻辑
- **FR-002**: harness_ci_watch 在 CI 通过后执行 auto-merge，失败时记录原因并跳过合并
- **FR-003**: 新增 harness_post_merge task_type，在所有 WS 合并完成后触发
- **FR-004**: harness_post_merge 检查整体 sprint contract 的所有条目是否达标
- **FR-005**: harness_post_merge 清理已合并 WS 的 worktree 目录和临时 git 分支
- **FR-006**: harness_post_merge 回写 Brain 任务状态为 completed，更新关联 OKR 进度
- **FR-007**: harness_post_merge 最后创建 harness_report 任务生成最终报告
- **FR-008**: stop.sh 在检测 .dev-lock 时，验证 worktree 目录实际存在后再判定为活跃

## 成功标准

- **SC-001**: Generator push 后，系统自动创建 harness_ci_watch 并轮询直到 CI 结束，无需人工介入
- **SC-002**: CI 通过后 PR 自动合并，CI 失败时不合并且记录原因
- **SC-003**: 所有 WS 合并后，harness_post_merge 自动执行 contract 校验、worktree 清理、Brain 回写
- **SC-004**: 最终 harness_report 包含完整的 sprint 执行结果（每个 WS 状态、contract 达标情况、OKR 进度变化）
- **SC-005**: stop.sh 不再因已删除 worktree 的残留分支而误阻退出

## 假设

- [ASSUMPTION: harness_ci_watch 和 harness_post_merge 复用现有 Brain tasks 表，无需 schema 迁移]
- [ASSUMPTION: harness-watcher.js 的轮询逻辑和间隔配置已满足需求，无需修改 watcher 本身]
- [ASSUMPTION: auto-merge 使用 gh pr merge 命令，遵循仓库现有的 merge 策略（squash/merge）]
- [ASSUMPTION: 单 WS sprint 场景下，post_merge 在该 WS 合并后立即触发，无需等待其他 WS]

## 边界情况

- CI 长时间 pending（超过 30 分钟）：ci_watch 应有超时机制，超时后标记为 timeout 并通知
- auto-merge 冲突：PR 因 merge conflict 无法合并，记录冲突信息，不强制合并
- worktree 清理时目录已不存在：静默跳过，不报错
- Brain API 回写失败：重试一次，仍失败则记录到报告中，不阻塞整体流程
- 部分 WS 的 CI 失败：post_merge 仍触发，但仅对成功合并的 WS 执行清理，报告中标注失败 WS

## 范围限定

**在范围内**:
- execution.js 中 Generator 完成后的 ci_watch 创建逻辑
- harness_post_merge task_type 的完整实现
- stop.sh 的 worktree 检测逻辑修复
- 与 harness-watcher.js 现有代码的接入

**不在范围内**:
- harness-watcher.js 本身的重写或重构
- GAN 对抗层（Phase 2-3）的修改
- Planner（Phase 1）的修改
- Dashboard UI 对 pipeline 状态的展示（已有独立 PR 处理）
- harness_report skill 本身的改动（仅改变触发时机）

## 预期受影响文件

- `packages/brain/src/execution.js`：Generator 完成后的逻辑从一次性 CI 查询改为创建 harness_ci_watch
- `packages/brain/src/harness-watcher.js`：被 ci_watch 调用，可能需要适配接口
- `packages/brain/src/task-router.js`：新增 harness_post_merge 和 harness_ci_watch 的路由映射
- `packages/engine/hooks/stop.sh`：修复 worktree 检测逻辑，增加目录存在性校验
- `packages/engine/hooks/stop-dev.sh`：与 stop.sh 共享检测逻辑，可能同步修复
