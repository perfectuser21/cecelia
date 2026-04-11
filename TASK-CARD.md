---
id: task-cp-04112239-harness-pipeline-detail
type: task-card
branch: cp-04112239-harness-pipeline-detail
created: 2026-04-11
---

# Task Card: feat(dashboard): Harness Pipeline 全链路详情页

**Brain Task ID**: a09ed538-846d-4222-bb2d-b02f05714975
**Branch**: cp-04112239-harness-pipeline-detail

## 需求（What & Why）

**功能描述**: 为每个 Harness Pipeline 添加详情页，展示从用户输入到最终生成的全链路数据（原始输入 → PRD → GAN 对抗轮次 DOD 草稿/反馈 → 最终合同 → 生成状态）

**背景**: 当前 Pipeline 列表页只展示 6 步状态概览，无法查看执行细节。GAN 对抗过程（DOD 草稿、Reviewer 反馈）散落在 git 分支文件中，需要人工 checkout 查看。

**不做什么**: 不提供内容编辑/重新触发能力、不做实时 WebSocket 推送、不修改 Harness 执行流程

## 成功标准

- [BEHAVIOR] 列表页点击卡片导航到 `/pipeline/:planner_task_id` 详情页
- [BEHAVIOR] 详情 API 返回阶段任务数据 + git 文件内容
- [BEHAVIOR] GAN 对抗轮次按 R1/R2/R3 展示 DOD 草稿 + verdict + 反馈
- [BEHAVIOR] 无数据时优雅降级，不报错

## 验收条件（DoD）

- [ ] [BEHAVIOR] GET /api/brain/harness-pipeline-detail?planner_task_id=xxx 返回 200 + stages 数组 + file_contents 对象
  Test: manual:curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=test-id" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.stages)process.exit(1);if(!d.file_contents&&d.file_contents!==null)process.exit(1);console.log('PASS')"

- [ ] [BEHAVIOR] 详情 API 对不存在的 planner_task_id 返回空 stages 而非 500
  Test: manual:curl -sf "localhost:5221/api/brain/harness-pipeline-detail?planner_task_id=nonexistent-id-999" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!Array.isArray(d.stages))process.exit(1);console.log('PASS:'+d.stages.length+' stages')"

- [ ] [ARTIFACT] 详情页组件文件存在: apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx
  Test: manual:node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx');console.log('OK')"

- [ ] [BEHAVIOR] 详情页路由 /pipeline/:id 已注册到 system-hub 和 execution feature
  Test: manual:node -e "const c=require('fs').readFileSync('apps/api/features/system-hub/index.ts','utf8');if(!c.includes('/pipeline/:'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 测试文件存在
  Test: tests/apps/dashboard/src/pages/harness-pipeline/__tests__/HarnessPipelineDetailPage.test.ts

## 实现方案

**要改的文件**:
- `packages/brain/src/routes/harness.js`：新增详情端点，查 tasks 表 + dev_records 表反查分支，exec git show 读文件
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`（新建）：详情页组件
- `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`：卡片添加 onClick 导航
- `apps/api/features/execution/api/harness-pipeline.api.ts`：新增详情 API 函数
- `apps/api/features/execution/index.ts`：注册详情页路由
- `apps/api/features/system-hub/index.ts`：注册详情页路由

**受影响函数/API**:
- `GET /api/brain/harness/pipeline/:planner_task_id`（已有，需扩展或新建详情端点）
- `PipelineCard` 组件（添加导航）
- `DynamicRouter` 路由注册

**不改什么**: 列表页数据聚合逻辑（status.js 的 harness-pipelines 端点）、Harness 执行流程
