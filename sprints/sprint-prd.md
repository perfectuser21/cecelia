# Sprint PRD — Harness Pipeline 全链路详情页

## 背景

当前 Dashboard 的 Pipeline 列表页（`/pipeline`）只展示 6 步流水线的状态概览（Planner→Propose→Review→Generate→CI Watch→Report）。用户无法看到每个 Pipeline 的完整执行细节：原始用户输入、Planner 产出的 PRD、GAN 对抗的每一轮 DOD 草稿与评审反馈、最终合同内容、以及生成阶段的产出。这些信息散落在 git 分支的文件中，需要人工 checkout 分支查看。

## 目标

为每个 Harness Pipeline 提供可点击的详情页，展示从用户输入到最终生成的全链路数据，让用户无需离开 Dashboard 即可审查整个 Pipeline 的决策过程。

## 功能列表

### Feature 1: Pipeline 详情 API

**用户行为**: 前端通过 planner_task_id 请求某个 Pipeline 的全链路详情数据
**系统响应**: 后端返回该 Pipeline 的：
  - 基础信息（标题、状态、时间线）
  - 每个阶段的任务数据（来自 tasks 表）
  - 每个阶段关联的 git 文件内容（sprint-prd.md、每轮 DOD 草稿、评审 verdict+反馈、最终 sprint-contract.md）
  - 通过 dev_records 反查每个阶段任务的分支名，再从 git 读取分支上的文件

**不包含**: 不提供文件编辑能力；不展示 git diff

### Feature 2: Pipeline 列表页点击导航

**用户行为**: 在现有 Pipeline 列表页（`/pipeline`）点击某条 Pipeline 卡片
**系统响应**: 导航到该 Pipeline 的详情页（`/pipeline/:planner_task_id`）

**不包含**: 不改变列表页的现有数据展示逻辑

### Feature 3: Pipeline 详情页 — 阶段时间线

**用户行为**: 用户在详情页顶部看到 Pipeline 的 6 步进度条
**系统响应**: 展示每个阶段的状态图标、耗时、PR 链接（与列表页展开视图类似但更详细）

**不包含**: 不需要实时更新（手动刷新即可）

### Feature 4: Pipeline 详情页 — GAN 对抗轮次展示

**用户行为**: 用户在详情页中查看 GAN 对抗过程
**系统响应**: 按轮次展示：
  - R1/R2/R3... 每轮的 DOD 草稿内容
  - 每轮的 Reviewer verdict（PASS/FAIL）和反馈文字
  - 最终通过的合同（sprint-contract.md）内容
  - 无 GAN 数据时显示"暂无对抗记录"占位

**不包含**: 不展示 GAN 过程的实时流式输出

### Feature 5: Pipeline 详情页 — 用户原始输入与 PRD

**用户行为**: 用户查看 Pipeline 的起源
**系统响应**: 展示：
  - Planner 任务的 payload 中的用户原始需求描述
  - sprint-prd.md 的内容（Markdown 渲染）

**不包含**: 不提供 PRD 编辑

### Feature 6: 无内容优雅降级

**用户行为**: 用户访问一个尚未完成所有阶段的 Pipeline 详情页
**系统响应**: 
  - 已完成阶段正常展示内容
  - 进行中阶段显示"执行中..."状态
  - 未开始阶段显示灰色占位
  - git 文件读取失败时显示"文件暂不可用"而非报错

**不包含**: 不自动重试失败的文件读取

## 成功标准

- 标准 1: 从 Pipeline 列表页点击任意卡片可导航到详情页，详情页 URL 为 `/pipeline/:planner_task_id`
- 标准 2: 详情页 API（`GET /api/brain/harness-pipeline-detail?planner_task_id=xxx`）返回完整的阶段任务数据和 git 文件内容
- 标准 3: GAN 对抗轮次（R1/R2/R3）的 DOD 草稿和评审反馈正确按轮次展示
- 标准 4: 无 GAN 数据或部分阶段未完成时，页面不报错，优雅降级展示

## 范围限定

**在范围内**:
- 新增 Backend API 端点读取 pipeline 详情 + git 文件
- 新增 Frontend 详情页组件
- 列表页卡片添加点击导航
- 路由注册

**不在范围内**:
- 不改变现有列表页的数据结构或聚合逻辑
- 不提供内容编辑/重新触发能力
- 不做实时 WebSocket 推送
- 不修改 Harness 执行流程本身

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增详情 API 端点，通过 tasks 表 + dev_records 表反查分支，读取 git 文件
- `packages/brain/src/routes/status.js`：可能需要在聚合端点返回 planner_task_id 供前端导航
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`：卡片添加点击事件，导航到详情页
- `apps/dashboard/src/pages/harness-pipeline/` (新文件)：详情页组件
- `apps/api/features/execution/api/harness-pipeline.api.ts`：新增详情 API 调用函数
- `apps/api/features/execution/pages/` (新文件)：apps/api 层的详情页组件
- `apps/api/features/execution/index.ts`：注册详情页路由
- `apps/api/features/system-hub/index.ts`：注册详情页路由（system-hub feature）
