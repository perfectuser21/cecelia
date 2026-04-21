# Contract DoD — Workstream 1: Time formatting utilities

**范围**: 新增 `packages/brain/src/utils/time-format.js`，导出 `isValidTimeZone(tz)` 与 `formatIsoAtTz(date, tz)` 两个纯函数。不触碰 Express、`server.js`、路由、数据库。
**大小**: S（<100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/src/utils/time-format.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/utils/time-format.js')"

- [ ] [ARTIFACT] 模块导出命名符号 `isValidTimeZone`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/utils/time-format.js','utf8');if(!/export\s+(?:async\s+)?(?:function|const|let|var)\s+isValidTimeZone\b|export\s*\{[^}]*\bisValidTimeZone\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 模块导出命名符号 `formatIsoAtTz`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/utils/time-format.js','utf8');if(!/export\s+(?:async\s+)?(?:function|const|let|var)\s+formatIsoAtTz\b|export\s*\{[^}]*\bformatIsoAtTz\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/package.json` dependencies 未新增条目（保持与主线 13 项一致）
  Test: node -e "const pkg=require('./packages/brain/package.json');const deps=Object.keys(pkg.dependencies||{}).sort();const expected=['@anthropic-ai/sdk','@langchain/langgraph','@langchain/langgraph-checkpoint-postgres','bullmq','dotenv','express','ioredis','js-yaml','natural','openai','pg','uuid','ws'].sort();if(JSON.stringify(deps)!==JSON.stringify(expected))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/utils/time-format.js` 不 import 任何 npm 依赖（除 Node 内置 API）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/utils/time-format.js','utf8');const m=c.match(/^\s*import\s+[^;]*from\s+['\"]([^'\"]+)['\"]/gm)||[];for(const line of m){const dep=line.match(/from\s+['\"]([^'\"]+)['\"]/)[1];if(!dep.startsWith('.')&&!dep.startsWith('node:'))process.exit(1)}"

## BEHAVIOR 索引（实际测试在 `packages/brain/src/__tests__/utils/`）

见 `packages/brain/src/__tests__/utils/time-format.test.js`，覆盖：
- isValidTimeZone returns true for UTC
- isValidTimeZone returns true for Asia/Shanghai
- isValidTimeZone returns false for invalid IANA name Foo/Bar
- isValidTimeZone returns false for empty string
- isValidTimeZone returns false for undefined
- formatIsoAtTz outputs ISO-8601 with offset suffix
- formatIsoAtTz roundtrips to the same instant
- formatIsoAtTz applies +08:00 offset for Asia/Shanghai
- formatIsoAtTz applies zero offset for UTC
