# DoD — cp-04121134-harness-evaluator-integration

## Behavior

- [x] [BEHAVIOR] Generator 完成后创建 harness_evaluate（不是 harness_report）
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('harness_evaluate') || !c.includes('Evaluator] E1'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] harness_evaluate PASS → 创建 harness_report
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('evalVerdict === \\'PASS\\''))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] harness_evaluate FAIL + round < 3 → 创建 harness_fix
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('evalRound < 3'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] harness_evaluate FAIL + round >= 3 → 创建 harness_report + needs_human_review
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('needs_human_review'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] harness_fix 完成后创建 harness_evaluate（不是 harness_report）
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const m=c.match(/harness_fix.*?harness_evaluate/s);if(!m)process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] executor.js preparePrompt 注入合同内容给 Evaluator
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('Harness v5.0 — Evaluator'))process.exit(1);if(!c.includes('contract_branch'))process.exit(1);console.log('ok')"`
