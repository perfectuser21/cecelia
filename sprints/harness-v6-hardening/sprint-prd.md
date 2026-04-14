# Sprint PRD — Harness Pipeline 加固 v6.0

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 88%
- **说明**：Harness Pipeline 是 Cecelia 自动化开发的核心基础设施，稳定性直接决定系统"可信赖"程度

## 背景

过去 48 小时跑通 5+ 个 Harness Pipeline，暴露 8 个真实问题：verdict 竞态导致误判 FAIL、bridge 崩溃触发无效 Fix 循环、孤儿 worktree 积累、产物清理缺失、前端监控盲区。这些问题叠加导致 pipeline 成功率低于预期，需要人工干预频率过高，违背了 Harness 自动化闭环的设计目标。

## 目标

消除 Harness Pipeline 的 8 个已知稳定性问题，使 pipeline 能在无人干预下完成完整生命周期（从 Planner 到 Cleanup），并提供可视化监控能力。

## User Stories

**US-001**（P0）: 作为系统运维者，我希望 verdict 评估不会因为写入延迟而误判 FAIL，以便 pipeline 不会无谓地进入 Fix 循环
**US-002**（P0）: 作为系统运维者，我希望 bridge 崩溃时系统能识别崩溃并重试评估，以便不会触发基于错误数据的 Fix 任务
**US-003**（P0）: 作为系统运维者，我希望 PR 合并后的孤儿 worktree 被自动清理，以便不需要手动管理磁盘空间
**US-004**（P1）: 作为系统运维者，我希望 pipeline 完成后的所有产物（worktree、远程分支、临时文件）被自动清理，以便系统不会积累垃圾
**US-005**（P1）: 作为系统运维者，我希望 pipeline detail 页面显示完整的 10 个步骤，以便我能看到 pipeline 的全生命周期状态
**US-006**（P1）: 作为系统运维者，我希望有一个仪表盘看到 pipeline 完成率、平均轮次和耗时，以便我能评估系统健康度
**US-007**（P2）: 作为系统运维者，我希望 callback queue 的积压和失败情况被监控，以便我能及时发现队列问题
**US-008**（P2）: 作为系统运维者，我希望已合并的 stale 远程分支被定期自动清理，以便 GitHub 仓库保持整洁

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）: Verdict 重试生效
- **Given** agent curl 写入 PASS 但延迟 500ms 到达数据库
- **When** callback 处理 harness_evaluate 任务
- **Then** callback 重试读取 DB，最终读到 PASS verdict，不会因首次读空而默认 FAIL

**场景 2**（关联 US-002）: Bridge 崩溃不进 Fix 循环
- **Given** bridge 输出 0 字节（session 静默崩溃）
- **When** callback 处理该结果
- **Then** 系统标记为 session_crashed，创建 harness_evaluate 重试任务（不是 harness_fix）

**场景 3**（关联 US-003）: 孤儿 worktree 自动清理
- **Given** 一个 cp-XXX 分支的 PR 已合并，但 worktree 目录仍存在
- **When** stop hook 检测到该孤儿 worktree
- **Then** 自动执行 git worktree remove，无需用户手动清理

**场景 4**（关联 US-005）: Pipeline detail 页面显示完整步骤
- **Given** 一个完整的 harness pipeline
- **When** 打开 pipeline detail 页面
- **Then** 显示 10 个步骤：Planner → Propose → Review → Generate → Evaluate → Report → Auto-merge → Deploy → Smoke-test → Cleanup

**场景 5**（关联 US-004）: Pipeline 产物自动清理
- **Given** 一个 pipeline 完成（report 阶段结束）
- **When** cleanup 步骤执行
- **Then** 对应的 worktree 被移除、远程分支被删除、/tmp/cecelia-* 临时文件被清理

**场景 6**（关联 US-006）: Pipeline 统计仪表盘
- **Given** 过去 30 天有多个 pipeline 运行记录
- **When** 打开 /pipelines/stats 页面
- **Then** 显示完成率、平均 GAN 轮次、平均耗时统计

**场景 7**（关联 US-007）: Callback Queue 监控
- **Given** callback_queue 表中有未处理和失败的记录
- **When** 查询 health 端点
- **Then** 返回 callback_queue_stats 字段，包含 unprocessed 和 failed_retries 计数

**场景 8**（关联 US-008）: Stale 分支批量清理
- **Given** 234+ 个 cp-harness-* 远程分支已 merge 超过 7 天
- **When** cleanup 脚本执行
- **Then** 这些分支被删除，保留未 merge 和 merge 不足 7 天的分支

## 功能需求

- **FR-001**: Verdict 评估加入 DB 重试循环（最多 10 次，每次间隔 200ms），确保延迟写入的 verdict 不被遗漏
- **FR-002**: 当 callback result 为 null 且 DB verdict 也为空时，标记为 session_crashed 并创建 harness_evaluate 重试任务（而非 harness_fix）
- **FR-003**: Stop hook 检测到孤儿 worktree（对应 PR 已合并）时自动执行 git worktree remove 清理
- **FR-004**: Autonomous 任务统一使用 /Users/administrator/worktrees/cecelia/ 路径创建 worktree
- **FR-005**: Pipeline 完成后触发 cleanup 流程：移除 worktree、删除远程分支、清理 /tmp/cecelia-* 文件
- **FR-006**: Pipeline detail API 返回完整 10 步（含 Auto-merge、Deploy、Smoke-test、Cleanup），前端组件适配渲染
- **FR-007**: Dashboard 新增 /pipelines/stats 页面，展示最近 30 天 pipeline 完成率、平均 GAN 轮次、平均耗时
- **FR-008**: Health 端点新增 callback_queue_stats 字段（unprocessed/failed_retries 计数），失败 3 次的记录触发告警
- **FR-009**: 新增 cleanup-stale-branches.sh 脚本，删除已 merge 超过 7 天的 cp-* 远程分支

## 成功标准

- **SC-001**: Verdict 重试机制在 agent 写入延迟 <=2s 的情况下，100% 能读到正确 verdict
- **SC-002**: Bridge 0 字节输出不再触发 harness_fix 任务，改为 harness_evaluate 重试
- **SC-003**: Stop hook 运行后，所有 PR 已合并的孤儿 worktree 被自动清理
- **SC-004**: Pipeline detail 页面显示完整 10 个步骤
- **SC-005**: /pipelines/stats 页面能正确展示最近 30 天统计数据
- **SC-006**: Health 端点包含 callback_queue_stats 字段
- **SC-007**: cleanup-stale-branches.sh 能正确识别并删除已 merge 超 7 天的 cp-* 分支

## 假设

- [ASSUMPTION: Verdict 重试上限 10 次 x 200ms = 2s 总等待时间足够覆盖绝大多数 DB 写入延迟]
- [ASSUMPTION: session_crashed 重试最多 1 次，避免无限重试循环]
- [ASSUMPTION: 孤儿 worktree 清理的 PR 合并状态通过 gh pr view 或 git branch -r 判断]
- [ASSUMPTION: stale 分支 7 天保留期足够长，不会误删正在使用的分支]
- [ASSUMPTION: Pipeline 的 10 步定义（含 Deploy/Smoke-test/Cleanup）是最终步骤列表，不会再扩展]

## 边界情况

- Verdict 重试 10 次后 DB 仍为空：应标记为 verdict_timeout 并记录告警，不默认 FAIL
- session_crashed 重试后再次崩溃：标记为 permanent_failure，不再重试，写入 error_message
- Stop hook 检测到 worktree 但 git worktree remove 失败（文件被锁定）：记录警告日志，不阻塞 hook 执行
- cleanup-stale-branches.sh 执行时 GitHub API rate limit：脚本分批删除，每批 30 个，间隔 1 秒
- Pipeline detail 页面请求的 pipeline 尚未到达 Auto-merge 步骤：后续步骤显示为 "pending" 状态

## 范围限定

**在范围内**:
- Verdict 竞态修复（FR-001）
- Bridge 崩溃识别与重试（FR-002）
- 孤儿 worktree 自动清理（FR-003、FR-004）
- Pipeline 产物清理验证/加固（FR-005）
- Pipeline detail 完整步骤（FR-006）
- Pipeline 统计仪表盘（FR-007）
- Callback queue 监控（FR-008）
- Stale 分支批量清理脚本（FR-009）

**不在范围内**:
- Callback queue 架构改动（已完成）
- Tick 死锁修复（已完成两版）
- Evaluator SKILL.md 临时 Brain 5222 逻辑（已部署）
- Pipeline 步骤的新增（只展示已有步骤，不新增业务逻辑）
- 自动部署到生产环境的实现（Deploy 步骤仅为状态展示）

## 预期受影响文件

- `packages/brain/src/execution.js`：verdict 竞态修复（重试循环）+ bridge 崩溃识别
- `packages/brain/src/harness.js`：pipeline-detail API 扩展步骤数组 + cleanup task_type
- `packages/engine/hooks/stop.sh` 或 `stop-dev.sh`：孤儿 worktree 自动清理逻辑
- `packages/brain/src/health.js`：callback_queue_stats 字段
- `apps/dashboard/src/`：pipeline detail 组件 + /pipelines/stats 页面
- `scripts/cleanup-stale-branches.sh`：新增脚本
