# DoD: H15 — contract-verify.js 治本第一步

**日期**: 2026-05-10
**Sprint**: langgraph-contract-enforcement / Stage 2 MVP

## 验收条目

- [x] [BEHAVIOR] verifyProposerOutput 5 个 case（happy / branch missing / task-plan missing / invalid JSON / empty tasks）PASS
  Test: tests/brain/h15-contract-verify.test.js

- [x] [BEHAVIOR] verifyGeneratorOutput 3 个 case（happy / pr_url null / pr_not_found）PASS
  Test: tests/brain/h15-contract-verify.test.js

- [x] [BEHAVIOR] verifyEvaluatorWorktree 3 个 case（happy / 1 missing / 多 missing）PASS
  Test: tests/brain/h15-contract-verify.test.js

- [x] [BEHAVIOR] ContractViolation extends Error + name='ContractViolation' + details 对象
  Test: tests/brain/h15-contract-verify.test.js

- [x] [ARTIFACT] contract-verify.js 文件 exist + 4 named export（ContractViolation / verifyProposerOutput / verifyGeneratorOutput / verifyEvaluatorWorktree）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/lib/contract-verify.js','utf8');for(const n of ['ContractViolation','verifyProposerOutput','verifyGeneratorOutput','verifyEvaluatorWorktree']){if(!new RegExp(\`export (class|async function|function) \${n}\`).test(c))process.exit(1)}"

- [x] [ARTIFACT] proposer 节点（harness-gan.graph.js）import contract-verify + 调 verifyProposerOutput
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes('verifyProposerOutput'))process.exit(1);if(!c.includes(\"from '../lib/contract-verify.js'\"))process.exit(1)"

- [x] [ARTIFACT] evaluator 节点（harness-initiative.graph.js）import contract-verify + 调 verifyEvaluatorWorktree
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('verifyEvaluatorWorktree'))process.exit(1)"

- [x] [ARTIFACT] 测试文件 tests/brain/h15-contract-verify.test.js 存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h15-contract-verify.test.js')"
