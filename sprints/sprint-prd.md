# Sprint PRD — Pipeline 步骤详情：Input / Prompt / Output 三栏视图

## 背景

当前 Harness Pipeline 详情页按"阶段"展示（Planner / Propose / Review / Generate / CI Watch / Report 共 6 阶段），每个阶段只显示状态、耗时、PR 链接。用户无法了解每一步实际发生了什么——输入了什么数据、AI 收到了什么 prompt、AI 产出了什么内容。这对于理解 Pipeline 执行过程和调试失败步骤至关重要。

## 目标

用户打开任意 Pipeline 详情页后，能看到按时间排列的串行步骤列表，点击任一步骤可展开查看三栏内容：Input（输入数据）/ Prompt（发给 AI 的完整提示词）/ Output（AI 产出的文件内容）。

## 功能列表

### Feature 1: 串行步骤列表（Backend + Frontend）

**用户行为**: 用户点击某个 Pipeline 进入详情页
**系统响应**:
- 页面顶部保留标题、状态、时间信息
- 原有的"阶段时间线"横条保留作为概览导航
- 主体区域替换为串行步骤列表，每一步显示：步骤序号、类型标签（Planner / Propose R1 / Review R1 / Propose R2 / Review R2 / Generate / CI Watch / Report）、状态图标、耗时
- 步骤按 `created_at` 升序排列，同一类型多次出现时显示轮次编号（如 Propose R1, Propose R2）
**不包含**: 步骤之间的依赖关系图、步骤的并行可视化

### Feature 2: 三栏钻取视图（Backend + Frontend）

**用户行为**: 用户点击某个步骤
**系统响应**:
- 步骤行展开，显示三栏并排：Input | Prompt | Output
- 每栏带标题，内容用等宽字体 `<pre>` 渲染，支持滚动
- 无内容的栏显示"暂无数据"占位
- 同时只能展开一个步骤（手风琴模式）
**不包含**: Markdown 渲染、语法高亮、内容编辑功能

### Feature 3: 每步的 Input/Prompt/Output 数据重建（Backend）

**用户行为**: 前端请求 `GET /api/brain/harness/pipeline-detail?planner_task_id=xxx`
**系统响应**: API 返回新增的 `steps` 数组，每个元素包含：
- `step`: 序号（从 1 开始）
- `task_id`: 对应任务 ID
- `task_type`: harness_planner / harness_contract_propose / harness_contract_review / harness_generate / harness_report 等
- `label`: 人类可读标签（如 "Planner", "Propose R1", "Review R2"）
- `status`: 任务状态
- `created_at` / `completed_at`: 时间戳
- `input_content`: 该步骤的输入内容（字符串或 null）
- `prompt_content`: 发给 AI 的完整 prompt（字符串或 null）
- `output_content`: AI 产出的文件内容（字符串或 null）

各步骤的 Input/Prompt/Output 数据来源：

| 步骤类型 | Input | Prompt | Output |
|---------|-------|--------|--------|
| Planner | task.description（用户原始需求） | 从 executor.js preparePrompt 重建：skill名 + task_id + sprint_dir + description | sprint-prd.md（从 result.branch 的 git show 读取） |
| Propose | sprint-prd.md（从 planner_branch git show） | 从 executor.js 重建：skill名 + task_id + sprint_dir + propose_round + planner_branch + review_branch + 嵌入的 PRD/反馈 | contract-draft.md（从 result.branch git show） |
| Review | contract-draft.md（从 propose_branch git show） | 从 executor.js 重建：skill名 + task_id + sprint_dir + propose_branch + planner_branch + 嵌入的 PRD/合同草案 | contract-review-feedback.md（从 result.branch git show） |
| Generate | sprint-contract.md（从 contract_branch git show） | 从 executor.js 重建：skill名 + sprint_dir + contract_branch + 嵌入的合同内容 | dev_records 的 pr_url（PR diff 链接） |
| Report | 汇总所有步骤结果 | 从 executor.js 重建：skill名 + task_id + sprint_dir | harness-report.md（从 result.branch git show） |

**不包含**: 实时流式输出、prompt token 统计

## 成功标准

- 标准 1: 详情页加载后，`steps` 数组包含该 Pipeline 所有已执行步骤，按时间升序
- 标准 2: 点击任意步骤，三栏区域正确展示 Input/Prompt/Output，无内容时显示"暂无数据"
- 标准 3: Propose/Review 多轮对抗时，步骤列表正确交替显示 "Propose R1 → Review R1 → Propose R2 → Review R2..."
- 标准 4: prompt_content 的重建逻辑与 executor.js preparePrompt 一致，包含嵌入的文件内容

## 范围限定

**在范围内**:
- Backend: 更新 `GET /api/brain/harness/pipeline-detail` 响应，新增 `steps` 字段
- Backend: 新增 prompt 重建函数，复用 executor.js 中的 `_fetchSprintFile` 逻辑
- Frontend: 重写 `HarnessPipelineDetailPage.tsx` 主体区域为步骤列表 + 三栏视图
- 保留现有的阶段时间线概览横条

**不在范围内**:
- 修改 executor.js preparePrompt 本身
- 修改数据库 schema
- Markdown 渲染器
- 步骤的实时更新/WebSocket 推送
- 原有 GAN 对抗轮次卡片（被步骤列表替代）
- 原有文件内容折叠面板（被三栏视图替代）

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增 steps 构建逻辑，新增 prompt 重建函数，新增 git show 文件读取
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`：重写主体组件，新增步骤列表和三栏钻取视图
- `packages/brain/src/executor.js`：不修改，仅作为 prompt 重建逻辑的参考源
