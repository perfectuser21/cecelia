# Contract DoD — Workstream 3: Initiative Runner Pre-flight Gate 集成

**范围**: 在 `packages/brain/src/initiative-runner.js` 添加 `runPreflightGate(initiativeId)`，编排 validator + store + 状态机
**大小**: S
**依赖**: WS1（validator）、WS2（store）

## ARTIFACT 条目

- [ ] [ARTIFACT] initiative-runner.js 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/initiative-runner.js')"

- [ ] [ARTIFACT] initiative-runner.js 导出 runPreflightGate 函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/initiative-runner.js','utf8');if(!/export\s+(async\s+)?function\s+runPreflightGate\b|export\s*\{[^}]*\brunPreflightGate\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] initiative-runner.js import validatePreflight
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/initiative-runner.js','utf8');if(!/import\s*\{[^}]*\bvalidatePreflight\b[^}]*\}\s*from\s*['\"]\.\/preflight\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] initiative-runner.js import recordPreflightResult
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/initiative-runner.js','utf8');if(!/import\s*\{[^}]*\brecordPreflightResult\b[^}]*\}\s*from\s*['\"]\.\/preflight-store\.js['\"]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/preflight-gate.test.ts`，覆盖：
- advances state to ready_for_generator when preflight passes
- keeps state at awaiting_plan when preflight fails
- records exactly one preflight_results row per gate invocation regardless of verdict
- records failures array verbatim from validator into the store on fail
- throws when initiativeId is missing or empty
