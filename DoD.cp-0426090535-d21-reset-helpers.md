# DoD: cp-0426090535-d21-reset-helpers

- [x] [BEHAVIOR] tick-state.js 含 9 个 _resetLastXxxTime export；Test: manual:node -e "import('./packages/brain/src/tick-state.js').then(m=>{const fs=['_resetLastExecuteTime','_resetLastCleanupTime','_resetLastZombieCleanupTime','_resetLastHealthCheckTime','_resetLastKrProgressSyncTime','_resetLastHeartbeatTime','_resetLastGoalEvalTime','_resetLastZombieSweepTime','_resetLastPipelinePatrolTime'];for(const f of fs){if(typeof m[f]!=='function')process.exit(1)}})"
- [x] [BEHAVIOR] tick.js 不再含 `function _resetLast` 定义；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(/^function _resetLast/m.test(c))process.exit(1)"
- [x] [BEHAVIOR] 9 helper 仍可 import from './tick.js'（backwards-compat re-export）；Test: manual:node -e "import('./packages/brain/src/tick.js').then(m=>{if(typeof m._resetLastExecuteTime!=='function')process.exit(1)})"
- [x] [BEHAVIOR] tick-state.js 新增 re-export 段落标记存在；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes(\"from './tick-state.js'\"))process.exit(1)"
- [x] [ARTIFACT] tick-state.js 包含 _resetLastExecuteTime 实现；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick-state.js','utf8');if(!/_resetLastExecuteTime/.test(c))process.exit(1)"
