# Sprint PRD — Pipeline 详情页 Planner Output 数据补全

## OKR 对齐

- **对应 KR**: Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**: 82%
- **本次推进预期**: 完成后预计推进至 83%
- **说明**: Pipeline 详情页数据完整性是 Harness 可观测性的基础环节，直接支撑"系统可信赖"目标

## 背景

Harness Pipeline 详情页（`GET /api/brain/harness/pipeline-detail`）用于展示每个 Pipeline 运行中各步骤的输入/输出内容。当前 Planner 步骤完成后，其产出的 `planner_branch`（包含 sprint-prd.md）没有被持久化到任何可查询的位置——既没有写入 `dev_records`，也没有存入 `tasks.result`。导致：

1. **Planner 步骤的 output_content 始终为 null**：pipeline-detail API 无法找到 Planner 产出的 PRD 文件
2. **Propose 步骤的 input_content 为空**：Propose 阶段依赖 planner_branch 来定位 PRD 作为输入，但 planner_branch 经常为 null

这使得 Pipeline 详情页无法完整展示 Planner→Propose 的数据流转链路，降低了 Harness 的可观测性。

## 目标

让 Pipeline 详情页完整展示 Planner 步骤的产出（sprint-prd.md 内容）和 Propose 步骤的输入（来自 Planner 的 PRD），实现 Harness 各步骤数据链路的可追溯。

## User Stories

**US-001**（P0）: 作为运维人员，我希望在 Pipeline 详情页看到 Planner 步骤输出的 PRD 内容，以便了解每次 Pipeline 运行的需求分析结果

**US-002**（P0）: 作为运维人员，我希望 Propose 步骤的输入内容显示 Planner 产出的 PRD，以便追踪数据在 Pipeline 各步骤间的流转

**US-003**（P1）: 作为运维人员，我希望当 Planner 分支或 PRD 文件不存在时看到友好的提示而非空白，以便区分"未产出"和"数据丢失"

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）:
- **Given** 一个 Pipeline 的 Planner 步骤已完成，且 planner_branch 上存在 sprint-prd.md
- **When** 调用 `GET /api/brain/harness/pipeline-detail?pipeline_id=xxx`
- **Then** 返回的 steps[] 中 Planner 步骤的 `output_content` 包含 sprint-prd.md 的完整内容

**场景 2**（关联 US-001）:
- **Given** Planner 步骤刚完成
- **When** 查询该任务的 result 字段
- **Then** `tasks.result` 中包含 `branch` 字段，值为 planner_branch 名称

**场景 3**（关联 US-002）:
- **Given** 一个 Pipeline 已进入 Propose 阶段
- **When** 调用 `GET /api/brain/harness/pipeline-detail?pipeline_id=xxx`
- **Then** Propose 步骤的 `input_content` 包含 Planner 产出的 PRD 内容

**场景 4**（关联 US-003）:
- **Given** Planner 任务的 result.branch 指向一个已被删除的分支
- **When** 调用 pipeline-detail API
- **Then** Planner 步骤的 `output_content` 返回 null 或包含说明信息，API 不报错

## 功能需求

- **FR-001**: Planner 任务完成时，将 planner_branch 名称写入 `tasks.result.branch` 字段
- **FR-002**: pipeline-detail API 在构建 Planner 步骤数据时，从 `tasks.result.branch` 读取分支名，再从该分支读取 sprint-prd.md 文件内容作为 `output_content`
- **FR-003**: pipeline-detail API 在构建 Propose 步骤数据时，用 Planner 任务的 `result.branch` 定位 PRD 文件作为 `input_content`
- **FR-004**: 当 branch 不存在或 sprint-prd.md 文件不存在时，`output_content` / `input_content` 返回 null，不抛异常

## 成功标准

- **SC-001**: 对一个已完成 Planner 阶段的 Pipeline，pipeline-detail API 返回的 Planner 步骤 output_content 非 null 且包含 PRD 内容
- **SC-002**: 对一个已进入 Propose 阶段的 Pipeline，pipeline-detail API 返回的 Propose 步骤 input_content 非 null
- **SC-003**: 当 planner_branch 不存在时，API 正常返回且对应字段为 null，HTTP 200

## 假设

- [ASSUMPTION: tasks.result 字段为 JSONB 类型，可直接追加 branch 键]
- [ASSUMPTION: sprint-prd.md 的路径格式为 `sprints/<sprint_dir>/sprint-prd.md`，位于 planner_branch 的 worktree 根目录下]
- [ASSUMPTION: 读取 git 分支上的文件内容可通过 `git show <branch>:<path>` 实现]
- [ASSUMPTION: Planner 任务完成的回写时机是 Planner skill 执行结束后（push 之后）]

## 边界情况

- planner_branch 已被删除（例如 PR 合并后分支清理）：应优雅降级返回 null
- sprint-prd.md 文件路径变化或不存在：应优雅降级返回 null
- Planner 任务失败未产出分支：result.branch 应为空，pipeline-detail 正确处理
- 并发查询：多个请求同时读取 git 分支文件内容，git show 命令应互不干扰

## 范围限定

**在范围内**:
- Planner 任务完成时的 branch 持久化
- pipeline-detail API 的 Planner output_content 补全
- pipeline-detail API 的 Propose input_content 补全
- 边界情况的优雅降级

**不在范围内**:
- Dashboard 前端页面的 UI 调整（前端已有渲染逻辑，数据补全后自动展示）
- 其他步骤（Generator/Evaluator）的 output_content 修复
- 历史 Pipeline 数据的回填
- sprint-prd.md 的内容格式校验

## 预期受影响文件

- `packages/brain/src/harness/` 目录下的 pipeline-detail 相关文件：补充 Planner output_content 和 Propose input_content 的读取逻辑
- `packages/brain/src/harness/` 目录下的 planner 调度相关文件：在 Planner 完成回调中写入 result.branch
- Planner skill 的输出处理逻辑：确保 planner_branch 被正确传递给任务回写
