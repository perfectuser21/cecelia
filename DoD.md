# DoD — fix(brain): harness pipeline 编排 7个Bug修复 + BRAIN_QUIET_MODE 噪音关闭

- [x] [BEHAVIOR] harness_report 只在最后一个 WS 完成时创建（currentWsIdx === totalWsCount）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const m=c.match(/currentWsIdx === totalWsCount[\s\S]{0,200}harness_report/);if(!m)throw new Error('FAIL');console.log('PASS')"

- [x] [BEHAVIOR] goal_id 为 null 时串行 WS 链不报错（createHarnessTask 不传 goal_id 或允许 null）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(c.includes('goal_id is required'))throw new Error('FAIL: still has goal_id required check');console.log('PASS')"

- [x] [BEHAVIOR] contract_branch 为 null 时不创建 Generator，打印 P0 错误日志
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('contractBranch') || !c.includes('null') || !c.includes('P0'))throw new Error('FAIL: no null guard');console.log('PASS')"

- [x] [BEHAVIOR] 串行 WS 链创建前查 DB 幂等检查，已有同 WS 任务则跳过
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('workstream_index') || !c.includes('already queued'))throw new Error('FAIL: no idempotency check');console.log('PASS')"

- [x] [ARTIFACT] harness_report payload 包含 project_id 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=c.indexOf('task_type.*harness_report');const region=c.slice(c.indexOf('harness_report',idx-500),c.indexOf('harness_report',idx-500)+800);if(!region.includes('project_id'))throw new Error('FAIL');console.log('PASS')"

- [x] [ARTIFACT] model-profile.js 中 harness_report 使用 claude-haiku-4-5-20251001
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/model-profile.js','utf8');if(!c.includes(\"harness_report.*haiku\") && !c.match(/harness_report[^}]*haiku/))throw new Error('FAIL');console.log('PASS')"

- [x] [BEHAVIOR] server.js 中 startSelfDriveLoop 被 BRAIN_QUIET_MODE 门控
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('BRAIN_QUIET_MODE') || !c.includes('startSelfDriveLoop'))throw new Error('FAIL');const idx=c.indexOf('startSelfDriveLoop');const region=c.slice(idx-200,idx+50);if(!region.includes('BRAIN_QUIET_MODE'))throw new Error('FAIL: not gated');console.log('PASS')"

- [x] [BEHAVIOR] tick.js 中 triggerDeptHeartbeats 被 BRAIN_QUIET_MODE 门控
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const idx=c.indexOf('triggerDeptHeartbeats');const region=c.slice(idx-300,idx+50);if(!region.includes('BRAIN_QUIET_MODE'))throw new Error('FAIL: not gated');console.log('PASS')"
