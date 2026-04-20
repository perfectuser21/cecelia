# DoD
- [x] [ARTIFACT] runner 注入凭据
  File: packages/brain/src/harness-initiative-runner.js
  Check: contains "CECELIA_CREDENTIALS: 'account1'"
- [x] [BEHAVIOR] 代码含凭据字符串
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-runner.js','utf8');if(!c.includes(\"CECELIA_CREDENTIALS: 'account1'\"))process.exit(1)"
