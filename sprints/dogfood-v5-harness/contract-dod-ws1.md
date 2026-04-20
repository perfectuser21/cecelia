# Contract DoD — Workstream 1: retry.js 实现与导出

**范围**: 新建 `packages/brain/src/retry.js`，实现并 ES module 导出 `fetchWithRetry` 函数与 `MAX_RETRIES` 常量。
**大小**: S（<100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/retry.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/retry.js')"

- [ ] [ARTIFACT] `packages/brain/src/retry.js` 导出 `fetchWithRetry` 命名符号
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/retry.js','utf8');if(!/export\s+(async\s+)?function\s+fetchWithRetry\b|export\s*\{[^}]*\bfetchWithRetry\b[^}]*\}|export\s+const\s+fetchWithRetry\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/retry.js` 导出 `MAX_RETRIES` 常量且字面值为 3
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/retry.js','utf8');if(!/export\s+const\s+MAX_RETRIES\s*=\s*3\b/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/retry.test.ts`，覆盖：

- returns successfully when op succeeds on the 4th attempt after 3 failures
- throws the original error after 3 retries all fail
- waits at least 1.5x longer between each consecutive retry
- calls op exactly once when it succeeds on the first try
