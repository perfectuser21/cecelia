# Task Card: Pipeline 全链路详情页 — Input/Prompt/Output 三栏视图

**Task ID**: 98503cee-f277-4690-8254-fb9058b5dee3
**Branch**: cp-04112334-pipeline-step-detail
**类型**: feat

## 用户需求

用户希望在 Harness Pipeline 详情页看到：
1. 串行步骤列表（Step 1 Planner → Step 2 Propose R1 → Step 3 Review R1 → ...）
2. 点击每个步骤展开 → 三栏视图：**Input**（输入内容）/ **Prompt**（发给 AI 的完整 prompt）/ **Output**（AI 产出的文件）

## DoD

- [x] Backend: `/api/brain/harness/pipeline-detail` 返回 `steps[]` 数组，每个 step 含 `input_content/prompt_content/output_content`
- [x] Frontend: HarnessPipelineDetailPage 改为串行步骤列表，每步可展开三栏视图
- [x] Planner step: prompt 从 task.description 重建，output 从 git branch 读 sprint-prd.md
- [x] Propose step: prompt 含 planner_branch + PRD + 上轮 review，output 读 contract-draft.md
- [x] Review step: prompt 含 propose_branch + 文件内容，output 读 review-feedback.md
- [x] 无数据时显示"暂无数据"占位

## 技术方案

### Backend (harness.js)
- 将现有 `stages[] + gan_rounds[]` 替换为序列化 `steps[]`
- 每个 step 从 `dev_records` 查 branch，用 `git show origin/{branch}:{file}` 读内容
- 按 executor.js 的 `preparePrompt()` 逻辑重建 prompt

### Frontend (HarnessPipelineDetailPage.tsx)
- 左侧/顶部：竖向步骤列表（图标+标签+状态+verdict）
- 展开：三个 panel（Input | Prompt | Output），各自可折叠
- monospace 预格式化内容
