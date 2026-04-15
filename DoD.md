# DoD

## [ARTIFACT] Files
- [x] `packages/brain/src/harness-router.js` 新建，导出 processHarnessRouting
  - Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/harness-router.js','utf8');if(!m.includes('export async function processHarnessRouting'))process.exit(1)"`
- [x] `packages/brain/src/callback-processor.js` 调用 processHarnessRouting
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/callback-processor.js','utf8');if(!c.includes('processHarnessRouting'))process.exit(1)"`
- [x] `packages/brain/src/routes/execution.js` 的 harness 路由已迁移为委托调用
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('processHarnessRouting'))process.exit(1);if(c.includes(\"harnessType === 'harness_planner'\"))process.exit(1)"`

## [BEHAVIOR] 运行时行为
- [x] harness-router.js 的 processHarnessRouting 接受完整上下文参数（task_id/harnessType/harnessPayload/result/pr_url/newStatus/harnessTask/pool/createHarnessTask）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-router.js','utf8');for(const k of ['task_id','harnessType','harnessPayload','result','pr_url','newStatus','harnessTask','pool','createHarnessTask']){if(!c.includes(k))process.exit(1)}"`
- [x] callback-processor.js 在 status update 完成后调用 processHarnessRouting（仅当 task_type 以 harness_ 开头）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/callback-processor.js','utf8');if(!c.includes(\"harnessType.startsWith('harness_')\"))process.exit(1);if(!c.includes('processHarnessRouting'))process.exit(1)"`
- [x] harness-router.js 覆盖所有 Layer 1-4 路由（planner/propose/review/generate/fix/evaluate/report）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-router.js','utf8');for(const t of ['harness_planner','harness_contract_propose','harness_contract_review','harness_generate','harness_fix','harness_evaluate','harness_report']){if(!c.includes(t))process.exit(1)}"`
- [x] routes/execution.js HTTP 端点的 harness 路由变成委托调用（接口不变，内部去重）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const count=(c.match(/processHarnessRouting/g)||[]).length;if(count<1)process.exit(1)"`
- [x] brace balance 全部 OK（3 个文件均可通过 node --check）
  - Test: `manual:bash -c "node --check packages/brain/src/harness-router.js && node --check packages/brain/src/callback-processor.js && node --check packages/brain/src/routes/execution.js"`
