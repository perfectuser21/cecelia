---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Dashboard UI + 状态图标 + 渲染测试

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 在 PipelineCard 内加 WsProgressSection（含所有 4 条 status→图标映射）；新建 `apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx` + `apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx`
**大小**: M (130-160 行，3 文件)
**依赖**: Workstream 2

## ARTIFACT 条目

- [x] [ARTIFACT] HarnessPipelinePage.tsx 含 ws-progress-section data-testid 属性
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('ws-progress-section'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] HarnessPipelinePage.tsx 含 ws-progress-row data-testid 属性
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('ws-progress-row'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] WsProgress.test.tsx 文件存在于 PRD 指定路径
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx');console.log('OK')"

- [x] [ARTIFACT] WsStatusIcon.test.tsx 文件存在于 PRD 指定路径
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/__tests__/WsStatusIcon.test.tsx');console.log('OK')"

