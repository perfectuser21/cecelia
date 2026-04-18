# DoD: LangGraph 路径注入凭据

- [x] [ARTIFACT] executor.js 在 runHarnessPipeline 调用前构建 langGraphEnv
  File: packages/brain/src/executor.js
  Check: contains "langGraphEnv.CECELIA_CREDENTIALS"

- [x] [BEHAVIOR] 调用 isSpendingCapped/isAuthFailed 检查 account1 可用
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('isSpendingCapped(\'account1\')'))process.exit(1)"

- [x] [BEHAVIOR] env 传给 runHarnessPipeline
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.match(/runHarnessPipeline\(task,\s*\{[^}]*env:/s))process.exit(1)"
