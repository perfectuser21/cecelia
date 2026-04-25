# Contract DoD — Workstream 3: 字段语义不变量（uptime 单调 + version 取自 package.json）

**范围**: 修改 `packages/brain/src/routes/health.js`，**实质性替换 WS1 占位**：（a）删除 `'pending'` 字面量；（b）`uptime_seconds` 通过 `process.uptime()` 获取（保证单调）；（c）`version` 通过读 `../../package.json` 获取（不写死字面量）。**预期 diff 行数下界 ≥ 3**：通过下方 ARTIFACT 三重组合保证（含 `package.json` token + 含 `process.uptime` + 含 `readFileSync`/`require` 引入模式 + 不含 `'pending'`），靠 ≤2 行 diff 无法同时满足。
**大小**: S
**依赖**: Workstream 1 PR 已 merged 进 main（要修改的目标文件由 WS1 创建）
**派发顺序**: Phase B 第二批，与 WS2/WS4 并发；与 WS2 无文件交集（WS2 改 server.js、WS3 改 routes/health.js）

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 含 `package.json` 字符串引用（require 或 readFileSync 均可）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/package\.json/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 含 `process.uptime` 调用（保证 uptime 来自 Node 运行时而非自构计时器）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(!/process\.uptime/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 不写死当前版本字面量 `1.222.0`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/['\"]1\.222\.0['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/health.js` 不写死任意 semver 字面量（无形如 `'X.Y.Z'` 的字符串）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/['\"]\d+\.\d+\.\d+['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] [实质性补丁] `packages/brain/src/routes/health.js` **不含** `'pending'` 或 `"pending"` 字面量字符串（强制 WS3 删除 WS1 占位）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');if(/['\"]pending['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] [实质性补丁] `packages/brain/src/routes/health.js` 含 `readFileSync` 调用 或 `require\([^)]*package\.json[^)]*\)` 模式之一（强制实质性引入 package.json 读取代码，而非靠注释含 token 蒙混）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/health.js','utf8');const a=/readFileSync\s*\(/.test(c);const b=/require\s*\(\s*['\"][^'\"]*package\.json[^'\"]*['\"]\s*\)/.test(c);if(!(a||b))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws3/）

见 `sprints/tests/ws3/invariants.test.ts`，覆盖：
- uptime_seconds strictly increases across calls separated by 1.1s
- version field equals the version string in packages/brain/package.json
- does not embed the version string as a hardcoded literal in routes/health.js
- 5 concurrent requests return consistent version and all status=ok
- removed the WS1 placeholder literal pending from routes/health.js

跑测命令（Repo Root）: `npx vitest run --config sprints/vitest.config.ts tests/ws3/`
