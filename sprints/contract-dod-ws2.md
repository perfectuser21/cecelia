# Contract DoD — Workstream 2: GET /api/time endpoint

**范围**: 新增 `packages/brain/src/routes/time.js`（Express Router），实现三个分支；在 `packages/brain/server.js` 注册路由。路由从 WS1 `../utils/time-format.js` 导入，不重复实现时区逻辑。错误路径必须走 Express 内建机制（`next(err)` 或 `res.status(4xx).json(...)`），不自建日志栈（FR-005 硬兜底）。
**大小**: M（100-200 行）
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/src/routes/time.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] 路由模块有 default export
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路由模块从 `../utils/time-format.js` 导入（复用 WS1 纯函数，不重复实现）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/from\s+['\"]\.\.\/utils\/time-format(?:\.js)?['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 路由模块 import 至少一个 WS1 命名符号（isValidTimeZone 或 formatIsoAtTz）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');const m=c.match(/import\s*\{([^}]+)\}\s*from\s*['\"]\.\.\/utils\/time-format(?:\.js)?['\"]/);if(!m)process.exit(1);const names=m[1].split(',').map(s=>s.trim());if(!names.some(n=>/\bisValidTimeZone\b|\bformatIsoAtTz\b/.test(n)))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` import 路由模块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/time(?:\.js)?['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 注册 `/api/time` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/time['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/package.json` dependencies 未新增条目
  Test: node -e "const pkg=require('./packages/brain/package.json');const deps=Object.keys(pkg.dependencies||{}).sort();const expected=['@anthropic-ai/sdk','@langchain/langgraph','@langchain/langgraph-checkpoint-postgres','bullmq','dotenv','express','ioredis','js-yaml','natural','openai','pg','uuid','ws'].sort();if(JSON.stringify(deps)!==JSON.stringify(expected))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 不含独立日志栈字面量（FR-005 硬兜底：禁 `console.log(` / `console.error(` / `winston` / `new Logger(`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');const bad=[/\bconsole\.(log|error|warn|info|debug)\s*\(/,/\brequire\(\s*['\"]winston['\"]\s*\)/,/\bfrom\s+['\"]winston['\"]/,/\bnew\s+Logger\s*\(/,/\bpino\s*\(/];for(const re of bad){if(re.test(c))process.exit(1)}"

## BEHAVIOR 索引（实际测试在 `packages/brain/src/__tests__/routes/`）

见 `packages/brain/src/__tests__/routes/time-endpoint.test.js`，覆盖：
- GET /api/time returns 200 with iso, timezone, unix fields
- iso field matches ISO-8601 with offset
- unix field is an integer
- iso parses back to within 2 seconds of unix
- GET /api/time?tz=Asia/Shanghai echoes timezone and uses +08:00 offset
- GET /api/time?tz=UTC echoes timezone with zero offset
- GET /api/time?tz=Foo/Bar returns 400 with error message mentioning tz
- GET /api/time?tz= (empty string) falls back to default and returns 200
- two adjacent requests return unix within 1 second of each other
