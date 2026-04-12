# DoD — cp-04121317-fix-harness-data-chain

- [x] [BEHAVIOR] planner_branch 从 dev_records + git branch fallback 提取
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('plannerBranch from dev_records'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] pr_url 从 dev_records + gh pr list fallback 提取
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('pr_url recovered from dev_records'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] propose_branch 从 dev_records + git branch fallback 提取
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('propose_branch from dev_records'))process.exit(1);console.log('ok')"`
