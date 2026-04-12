# Sprint PRD — Pipeline 节点详情页（Node Detail Drill-Down）

## 背景

当前 Harness Pipeline 详情页已具备三列展示能力（Input / Prompt / Output），但以折叠列表形式内嵌在主页面中，每个区块限高 500px。用户在审查长文本（如完整 SKILL.md system prompt、大型 PRD）时需要频繁滚动小窗口，体验受限。同时，当前 `prompt_content` 是运行时重建的 prompt 片段，而非 SKILL.md 原始全文，无法准确反映 Claude 实际接收的系统指令。

## 目标

将 Pipeline 详情页的步骤列表改为可点击的节点卡片布局，点击任意节点进入独立的全屏详情视图，以三个全量滚动区块展示该步骤的 User Input、System Prompt（SKILL.md 全文）和 Output。

## 功能列表

### Feature 1: 节点卡片布局（Pipeline 详情页改版）

**用户行为**: 用户在 `/pipeline/:id` 页面看到所有步骤以卡片形式排列（保留现有的 Stage Timeline），每张卡片显示步骤名称、状态图标、verdict 徽章、耗时。
**系统响应**: 卡片可点击，点击后导航到该步骤的独立详情子页面。
**不包含**: 不改变 Stage Timeline 的设计；不改变 Pipeline 列表页。

### Feature 2: 步骤详情子页面（Node Detail View）

**用户行为**: 用户点击节点卡片，浏览器导航到 `/pipeline/:id/step/:step`，看到三个并列或堆叠的全量展示区块：
1. **User Input** — 该步骤的输入内容（Planner 为用户原始描述，Proposer 为 sprint-prd.md，Reviewer 为 contract-draft.md，以此类推）
2. **System Prompt** — 该步骤对应 skill 的 SKILL.md 全文内容
3. **Output** — 该步骤实际产出的文件内容（Planner → sprint-prd.md，Proposer → contract-draft.md，Reviewer → contract-review-feedback.md 等）

**系统响应**:
- 三个区块均使用等宽字体（monospace / preformatted）全量展示，支持自然滚动，不截断
- 无内容时该区块显示「暂无数据」占位
- 页面顶部有返回按钮，可回到 Pipeline 详情页

**不包含**: 不提供内容编辑功能；不做语法高亮（纯文本展示即可）。

### Feature 3: Backend 新增 system_prompt_content 字段

**用户行为**: 前端请求 pipeline-detail 时，每个 step 自动携带 SKILL.md 原始全文。
**系统响应**: `/api/brain/harness/pipeline-detail` 响应中，每个 step 对象新增 `system_prompt_content` 字段，值为对应 skill 的 SKILL.md 文件全文内容（从文件系统读取 `packages/workflows/skills/{skill-name}/SKILL.md`）。skill 名称从 task_type 映射（harness_planner → harness-planner，harness_contract_propose → harness-contract-proposer，等）。
**不包含**: 不缓存 SKILL.md 内容；不从 git 分支读取（直接读当前文件系统即可）。

## 成功标准

- 标准 1: Pipeline 详情页显示节点卡片，每个卡片展示步骤名、状态、verdict、耗时
- 标准 2: 点击卡片导航到 `/pipeline/:id/step/:step`，页面加载成功
- 标准 3: 步骤详情页三个区块（User Input / System Prompt / Output）均使用等宽字体全量展示
- 标准 4: System Prompt 区块展示 SKILL.md 完整内容（非重建 prompt）
- 标准 5: 任一区块无内容时显示「暂无数据」
- 标准 6: 返回按钮可正确回到 Pipeline 详情页

## 范围限定

**在范围内**:
- Pipeline 详情页的步骤展示改为卡片布局
- 新增步骤详情子路由和子页面
- Backend pipeline-detail 端点增加 system_prompt_content 字段
- task_type → skill 名称的映射逻辑

**不在范围内**:
- Pipeline 列表页改动
- Stage Timeline 重设计
- 语法高亮或 Markdown 渲染
- SKILL.md 内容缓存机制
- 其他 Brain API 端点变更

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：pipeline-detail 端点，新增 system_prompt_content 字段读取逻辑
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`：步骤列表改为卡片布局，移除折叠展开逻辑
- `apps/dashboard/src/pages/harness-pipeline/`：新增步骤详情子页面组件（如 HarnessPipelineStepPage.tsx）
- `apps/dashboard/src/`：路由配置需支持 `/pipeline/:id/step/:step` 子路由（DynamicRouter 配置驱动）
