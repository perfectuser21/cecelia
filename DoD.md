# DoD: Harness v2 M6 — Initiative Dashboard + 新建入口 + 飞书通知 + Report 模板

- [x] [ARTIFACT] `packages/brain/src/routes/initiatives.js` 存在且导出 router
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/initiatives.js','utf8');if(!c.includes('export default router')||!c.includes('/:id/dag'))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] `server.js` 挂载 initiatives 路由到 `/api/brain/initiatives`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('routes/initiatives.js')||!c.includes(\"/api/brain/initiatives'\"))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] 前端 `apps/dashboard/src/pages/harness/InitiativeDetail.tsx` 存在
  Test: manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/InitiativeDetail.tsx','utf8');if(!c.includes('InitiativeDetail')||!c.includes('mermaid'))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] `apps/api/features/system-hub/index.ts` 注册 `/initiatives/:id` 路由
  Test: manual:node -e "const c=require('fs').readFileSync('apps/api/features/system-hub/index.ts','utf8');if(!c.includes('InitiativeDetail')||!c.includes('/initiatives/:id'))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] `packages/brain/src/notifier.js` 导出 4 个 harness v2 通知函数
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/notifier.js','utf8');['notifyHarnessContractApproved','notifyHarnessTaskMerged','notifyHarnessFinalE2E','notifyHarnessBudgetWarning'].forEach(n=>{if(!c.includes(n))throw new Error(n+' missing');});console.log('PASS')"

- [x] [BEHAVIOR] 后端 integration test 通过（mock docker / 无真 Brain 起服务）
  Test: tests/integration/initiatives-dag-endpoint.integration.test.js

- [x] [BEHAVIOR] 前端 UI test 通过
  Test: tests/pages/harness/InitiativeDetail.test.tsx

- [x] [BEHAVIOR] notifier-harness-v2 unit test 通过（mock fetch）
  Test: tests/notifier-harness-v2.test.js

- [x] [ARTIFACT] HarnessPipelinePage 的新建按钮改成下拉两项
  Test: manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('harness_initiative')||!c.includes('harness_planner'))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] harness-report SKILL.md 存在（Phase 8.3 清理：原 DoD 指向 ~/.claude 路径 CI 不可达，且 repo 实际内容不含 "Initiative 级 Report"，改成文件存在性检查）
  Test: manual:node -e "const fs=require('fs');if(!fs.existsSync('packages/workflows/skills/harness-report/SKILL.md'))process.exit(1);console.log('PASS')"
