# Contract DoD — Workstream 4: Runner 集成与 fail-close 拦截

**范围**: 新增 `packages/brain/src/initiative-runner.js`，导出 `runInitiative({ initiativeId, deps })`。在派发 Generator 前 await 预检调用，rejected/throw 都 fail-close。
**大小**: M
**依赖**: ws3 完成

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/src/initiative-runner.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/initiative-runner.js')"

- [ ] [ARTIFACT] 模块导出名 `runInitiative`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/initiative-runner.js','utf8');if(!/export\s+(async\s+)?function\s+runInitiative|export\s*\{[^}]*\brunInitiative\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 模块包含调用预检的代码（标识符 `preflight` 或 `runPreflight`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/initiative-runner.js','utf8');if(!/(preflight|runPreflight)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 模块包含 fail-close 路径（出现 `try` 与 `catch`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/initiative-runner.js','utf8');if(!(/\btry\s*\{/.test(c)&&/\bcatch\s*\(/.test(c)))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `tests/ws4/runner-integration.test.ts`，覆盖：
- does not invoke Generator when preflight returns rejected
- invokes Generator exactly once when preflight returns passed
- does not invoke Generator when preflight throws (fail-close default)
- writes reasons array into task result when preflight rejects
- logs an error when preflight throws
