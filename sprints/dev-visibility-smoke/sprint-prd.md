# Sprint PRD — Dev-Visibility 冒烟验证（Generator PRD 注入）

## OKR 对齐

- **对应 KR**：KR-Harness（开发工作流可观测性）
- **当前进度**：WS2/3/4 已合并（#3142）
- **本次推进预期**：端到端确认 generator 收到完整 Sprint PRD

## 背景

WS2/3/4（#3142）实现了任务登记 + Generator PRD 注入 + SKILL 串行化。本 sprint 是冒烟验证：在真实 harness 运行中确认 generator 收到含完整 Sprint PRD 的 prompt，且 Brain 有对应任务记录。

## Golden Path（核心场景）

系统从 [harness 启动 generator 节点] → 经过 [Brain 注入 sprint-prd.md 内容到 generator prompt] → 到达 [generator prompt 含 `## Sprint PRD` 段，且 Brain tasks 表有该任务记录]

具体：

1. harness 执行到 generator 节点时，Brain 构建含 PRD 的 generator prompt
2. prompt 顶部出现 `## Sprint PRD` 段，内容为 sprint-prd.md 全文
3. /dev 任务完成后，Brain tasks 表存在对应 task_id 的记录，status 非 pending

## Response Schema

N/A — 任务无 HTTP 响应；验收通过 Brain API 查询（`GET /api/brain/tasks/:id`）

## 验收标准（DoD）

- [BEHAVIOR] generator prompt 包含 `## Sprint PRD` 字面段（不截断）
- [BEHAVIOR] Brain tasks 表在 /dev 完成后有对应 task_id 记录（status = completed 或 in_progress）
- [ARTIFACT] `sprints/dev-visibility-smoke/sprint-prd.md` 存在且非空

## 边界情况

- sprint-prd.md 不存在时：generator prompt 应含错误标注，不得静默跳过

## 范围限定

**在范围内**：generator prompt PRD 注入存在性、Brain 任务记录存在性
**不在范围内**：generator 输出代码质量、SKILL 串行化逻辑（WS4 已覆盖）、PRD 内容语义正确性

## 假设

- [ASSUMPTION: WS2/3/4 (#3142) 已合并到 main，当前 worktree 包含该逻辑]
- [ASSUMPTION: Brain API 在 localhost:5221 可达（验收时需确认服务运行）]

## 预期受影响文件

- `packages/engine/scripts/harness/`: generator prompt 构建逻辑（验证点）
- `packages/brain/src/`: tasks 表查询端点（`GET /api/brain/tasks/:id`）

## journey_type: dev_pipeline
## journey_type_reason: 验证 harness 引擎 generator 节点的 PRD 注入行为，属于开发工作流管道端到端验证
## target_environment: mac_web
## target_environment_reason: 任务参数显式指定 mac_web（Cecelia 本机，localhost:5221 Brain + 本地 harness 运行）
