# Task Card: feat(dashboard): Harness Pipeline 可视化页面

**Brain Task ID**: 360d66a1  
**Branch**: cp-04112000-harness-pipeline-dashboard  
**PR**: TBD

## 目标

在 Dashboard 新增 `/pipeline` 页面，可视化展示 Harness GAN Pipeline 的运行状态。

## 成功标准

- `/pipeline` 路由可访问，展示 harness_planner 任务列表
- 每个 pipeline 展示 6 步状态徽章：Planner / Propose / Review / Generate / Evaluate / Report
- 状态实时刷新（15s 间隔自动刷新）
- 点击卡片展开子任务详情

## DoD

- [x] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 已创建
  - Test: `manual:node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx');console.log('OK')"`

- [x] [BEHAVIOR] `/pipeline` 路由已注册到 system-hub manifest
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/api/features/system-hub/index.ts','utf8');if(!c.includes('/pipeline'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] `HarnessPipelinePage` 组件已在 manifest components 中注册
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/api/features/system-hub/index.ts','utf8');if(!c.includes('HarnessPipelinePage'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] 测试文件存在且 19 个测试全通过
  - Test: `tests/apps/dashboard/src/pages/harness-pipeline/__tests__/HarnessPipelinePage.test.ts`
