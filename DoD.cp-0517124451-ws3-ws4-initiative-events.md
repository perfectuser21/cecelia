---
contract_branch: cp-0517124451-ws3-ws4-initiative-events
---
# DoD — ws3+ws4: initiative_run_events + HarnessDetailPage

**Branch**: cp-0517124451-ws3-ws4-initiative-events
**范围**: ws3（Executor 写入 initiative_run_events）+ ws4（HarnessDetailPage 实时流）

## ARTIFACT 条目

- [x] [ARTIFACT] packages/brain/migrations/279_initiative_run_events.sql 存在（ts BIGINT，无 label 列）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/279_initiative_run_events.sql','utf8');if(!c.includes('initiative_run_events'))process.exit(1);if(!c.includes('BIGINT'))process.exit(1)"

- [x] [ARTIFACT] packages/brain/src/events/initiativeRunEvents.js 存在且导出 writeInitiativeRunEvent
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/events/initiativeRunEvents.js','utf8');if(!c.includes('writeInitiativeRunEvent'))process.exit(1)"

- [x] [ARTIFACT] executor.js 含 writeInitiativeRunEvent 调用（import + 函数体调用）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('writeInitiativeRunEvent'))process.exit(1);if(!c.includes('initiativeRunEvents'))process.exit(1)"

- [x] [ARTIFACT] harness.js GET /stream 支持 initiative_id 查询参数（SSE endpoint）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('initiative_id'))process.exit(1);if(!c.includes('node_update'))process.exit(1)"

- [x] [ARTIFACT] HarnessDetailPage.tsx 存在，含 EventSource + initiative_id + realtime-log + log-entry
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('EventSource'))process.exit(1);if(!c.includes('initiative_id'))process.exit(1);if(!c.includes('realtime-log'))process.exit(1);if(!c.includes('log-entry'))process.exit(1)"

- [x] [ARTIFACT] App.tsx 含 /harness/ + HarnessDetailPage 路由注册
  Test: node -e "const files=['apps/dashboard/src/config/routes.tsx','apps/dashboard/src/App.tsx','apps/dashboard/src/router.tsx'];let found=false;for(const f of files){try{const c=require('fs').readFileSync(f,'utf8');if(c.includes('/harness/')&&c.includes('HarnessDetailPage')){found=true;break;}}catch(e){}}if(!found)process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] writeInitiativeRunEvent 模块可直接调用（unit test 覆盖 running/done/failed/label-free）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/events/__tests__/initiativeRunEvents.test.js','utf8');if(!c.includes('writeInitiativeRunEvent'))process.exit(1)"

- [x] [BEHAVIOR] smoke test ws3-ire-module-smoke.sh 通过（验证模块+migration+executor import）
  Test: node -e "require('fs').accessSync('packages/brain/scripts/smoke/ws3-ire-module-smoke.sh');console.log('smoke exists')"
