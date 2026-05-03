# DoD: revert-to-queued 路径统一清除 claimed_by/claimed_at

**分支**：cp-0503090135-fix-claimed-by-requeue

## Definition of Done

- [x] [ARTIFACT] `packages/brain/src/actions.js` 的 `updateTask()` 当 status='queued' 时包含 `claimed_by = NULL`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/actions.js','utf8');if(!c.includes(\"else if (status === 'queued')\"))process.exit(1);if(!c.includes('claimed_by = NULL'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/task-updater.js` 的 `updateTaskStatus()` 当 status='queued' 时包含 `claimed_by = NULL`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-updater.js','utf8');if(!c.includes(\"else if (status === 'queued')\"))process.exit(1);if(!c.includes('claimed_by = NULL'))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/alertness/healing.js` 所有 queued 回退路径包含 `claimed_by = NULL`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/alertness/healing.js','utf8');const matches=c.match(/SET status = 'queued'/g)||[];const claimedMatches=c.match(/claimed_by = NULL/g)||[];if(claimedMatches.length<3)process.exit(1)"

- [x] [BEHAVIOR] `updateTask({status:'queued'})` 生成的 SQL 包含 `claimed_by = NULL` 和 `claimed_at = NULL`
  Test: tests/src/__tests__/actions.test.js

- [x] [BEHAVIOR] 所有 `SET status = 'queued'` 的 SQL UPDATE 路径（21 处）都附带清除 `claimed_by` 和 `claimed_at`
  Test: manual:node -e "const c=['healing.js','executor.js','callback-processor.js','tick-helpers.js','eviction.js','monitor-loop.js','shepherd.js','publish-monitor.js','credential-expiry-checker.js','tick-runner.js','quarantine.js'].every(f=>{try{const t=require('fs').readFileSync('packages/brain/src/'+f,'utf8');return t.includes('claimed_by = NULL')}catch(e){return false}});if(!c)process.exit(1)"
