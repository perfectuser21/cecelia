---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: Dashboard WS 进度可视化

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 新增 `WsProgressSection` 组件，每个 harness_initiative 卡片展示各 WS 的状态图标 / evaluate_verdict / PR 链接；`packages/brain/src/routes/status.js` `buildPipelineRecord` 返回 `task_type` 字段
**大小**: M（~80 行净增，2 文件）
**依赖**: Workstream 1（`GET /api/brain/harness/initiative/:id/ws-progress` 端点）

## ARTIFACT 条目

- [x] [ARTIFACT] `HarnessPipelinePage.tsx` 含 `WsProgressSection` 组件定义
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('WsProgressSection'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `HarnessPipelinePage.tsx` 含 `data-testid="ws-progress-section"` 属性
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('ws-progress-section'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `HarnessPipelinePage.tsx` 含 `WsWorkstream` interface（含 evaluate_verdict 字段）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('WsWorkstream'))process.exit(1);if(!c.includes('evaluate_verdict'))process.exit(2);console.log('OK')"

- [x] [ARTIFACT] `status.js` `buildPipelineRecord` 返回 `task_type: task.task_type`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');const fn=c.slice(c.indexOf('function buildPipelineRecord'),c.indexOf('function buildPipelineRecord')+2000);if(!fn.includes('task_type: task.task_type'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `HarnessPipelinePage.tsx` Pipeline interface 含 `task_type` 可选字段
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');const iface=c.slice(c.indexOf('interface Pipeline'),c.indexOf('interface Pipeline')+600);if(!iface.includes('task_type'))process.exit(1);console.log('OK')"
