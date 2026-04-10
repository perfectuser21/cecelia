contract_branch: cp-harness-propose-r2-91db397b
workstream_index: 1
sprint_dir: sprints/harness-pipeline-fix

- [x] [ARTIFACT] `packages/brain/src/__tests__/harness-pipeline.test.ts` 存在且包含 >= 5 个 describe 块
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/__tests__/harness-pipeline.test.ts','utf8');const d=(s.match(/describe\(/g)||[]).length;if(d<5){process.exit(1)};console.log('OK:'+d)"
- [x] [BEHAVIOR] report 触发时机：harness_report 创建位于 `currentWsIdx === totalWsCount` 条件块内
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=s.indexOf('currentWsIdx === totalWsCount');if(i<0)process.exit(1);if(!s.slice(i,i+800).includes('harness_report'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] goal_id 绕过：`execution_callback_harness` 在 actions.js 白名单中
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/actions.js','utf8');if(!s.includes('execution_callback_harness'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] contract_branch null guard：!contractBranch guard 包含 [P0] + return
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=s.indexOf('!contractBranch');if(i<0)process.exit(1);const r=s.slice(i,i+400);if(!r.includes('[P0]'))process.exit(1);if(!r.includes('return'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] 串行链幂等：harness WS 幂等保护日志精确命中
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=s.indexOf('already queued, skip creation');if(i<0)process.exit(1);const r=s.slice(Math.max(0,i-200),i+100);if(!r.includes('WS'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] harness_report 使用 Haiku 模型
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/model-profile.js','utf8');if(!/harness_report[^}]*haiku/.test(s))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] BRAIN_QUIET_MODE 门控 startSelfDriveLoop 和 triggerDeptHeartbeats
  Test: node -e "const s=require('fs').readFileSync('packages/brain/server.js','utf8');const t=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!s.includes('BRAIN_QUIET_MODE'))process.exit(1);if(!t.includes('BRAIN_QUIET_MODE'))process.exit(1);console.log('PASS')"
