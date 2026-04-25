# Contract DoD — Workstream 3: 字段语义不变量（uptime 单调 + version 取自 package.json）

**范围**: 完善 `packages/brain/src/routes/health.js` 的实现细节——`uptime_seconds` 通过 `process.uptime()` 获取，`version` 通过读 `../../package.json` 获取（不写死字面量）。
**大小**: S
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 含 `package.json` 字符串引用（require 或 readFileSync 均可）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/package\.json/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 不写死当前版本字面量 `1.222.0`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/['\"]1\.222\.0['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 不写死任意 semver 字面量（无形如 `'X.Y.Z'` 的字符串）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/['\"]\d+\.\d+\.\d+['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 含 `process.uptime` 调用（保证 uptime 来自 Node 运行时而非自构计时器）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/process\.uptime/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/invariants.test.ts`，覆盖：
- uptime_seconds strictly increases across calls separated by 1.1s
- version field equals the version string in packages/brain/package.json
- does not embed the version string as a hardcoded literal in routes/health.js
- 5 concurrent requests return consistent version and all status=ok
