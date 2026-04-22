# Contract DoD — Workstream 1: HTTP server 骨架 + routes 自动加载器 + `/iso` + 404/405 + 仓库根 vitest 配置

**范围**: 新建 `scripts/harness-dogfood/time-api.js`（HTTP server + 404/405 + routes 目录自动加载器 + require.main 直跑分支）；新建 `scripts/harness-dogfood/routes/iso.js`（`/iso` handler 实现）；新建 `scripts/harness-dogfood/__tests__/iso.test.js` 与 `scripts/harness-dogfood/__tests__/not-found.test.js`（均用 Node 内置 `node:test`，自己 `require('../time-api.js')` → `createServer(0)` → fetch → 断言 → close server）；**Round 4 新增**：在**仓库根**新建 `vitest.config.ts`，`test.include` 显式含 `sprints/tests/**/*.test.ts`，锁死 "vitest 确实发现 BEHAVIOR 测试"的契约。WS2/WS3 只新增 `routes/<name>.js`，无需改 time-api.js——自动加载器负责注册。

**大小**: M（time-api.js 约 70-100 行 + routes/iso.js 约 10-15 行 + 2 个 node:test 兼容层约 60-80 行 + 仓库根 vitest.config.ts 约 10-15 行）

**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/harness-dogfood/time-api.js` 文件存在
  Test: test -f scripts/harness-dogfood/time-api.js

- [ ] [ARTIFACT] `scripts/harness-dogfood/routes/iso.js` 文件存在（物理分文件第一块）
  Test: test -f scripts/harness-dogfood/routes/iso.js

- [ ] [ARTIFACT] time-api.js 导出 createServer（module.exports.createServer 或 exports.createServer 或 module.exports = {...createServer...}）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/(module\.exports\.createServer|exports\.createServer|module\.exports\s*=\s*\{[\s\S]*createServer)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 导出 routes 对象
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/(module\.exports\.routes|exports\.routes|module\.exports\s*=\s*\{[\s\S]*routes)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 routes 目录自动加载器（`readdirSync` 扫 routes 目录）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/readdirSync\s*\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 `not_found` 错误体字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/not_found/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 `method_not_allowed` 错误体字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/method_not_allowed/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 读取 PORT 环境变量
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/process\.env\.PORT/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 `require.main === module` 直跑分支
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/require\.main\s*===\s*module/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 不引入任何非 Node 内置模块（SC-006 "仅 Node 标准库"）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');const reqs=[...c.matchAll(/require\(['\x22]([^'\x22]+)['\x22]\)/g)].map(m=>m[1]);const builtins=new Set(['http','url','os','path','fs','util','net','querystring','node:http','node:url','node:os','node:path','node:fs','node:util','node:net']);const bad=reqs.filter(r=>!builtins.has(r)&&!r.startsWith('./')&&!r.startsWith('../'));if(bad.length>0){console.error('FAIL: non-builtin requires: '+bad.join(','));process.exit(1)}"

- [ ] [ARTIFACT] time-api.js 源码**不含** `/timezone` 字面量（物理隔离契约：timezone 字面量只能在 routes/timezone.js）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/\/timezone/.test(c)){console.error('FAIL: time-api.js 不应含 /timezone，它只能在 routes/timezone.js');process.exit(1)}"

- [ ] [ARTIFACT] time-api.js 源码**不含** `/unix` 字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/\/unix/.test(c)){console.error('FAIL: time-api.js 不应含 /unix，它只能在 routes/unix.js');process.exit(1)}"

- [ ] [ARTIFACT] time-api.js 源码**不含** `Intl.DateTimeFormat` 字面量（timezone 实现应在 routes/timezone.js）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/Intl\.DateTimeFormat/.test(c)){console.error('FAIL: time-api.js 不应含 Intl.DateTimeFormat');process.exit(1)}"

- [ ] [ARTIFACT] routes/iso.js 导出 `{path, handler}` 形状
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/iso.js','utf8');if(!/(module\.exports\s*=\s*\{[\s\S]*path[\s\S]*handler|exports\.path|exports\.handler)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/iso.js 含 `/iso` 路径字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/iso.js','utf8');if(!/['\x22]\/iso['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/iso.js 含 ISO 8601 响应生成逻辑（`toISOString` 调用）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/iso.js','utf8');if(!/toISOString\s*\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：scripts/harness-dogfood/__tests__/iso.test.js 文件存在
  Test: test -f scripts/harness-dogfood/__tests__/iso.test.js

- [ ] [ARTIFACT] PRD 兼容层：__tests__/iso.test.js 使用 Node 内置 node:test（含 `node:test` 字面量）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/iso.test.js','utf8');if(!/node:test/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：__tests__/iso.test.js 真实 require 被测模块 time-api.js（不空壳）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/iso.test.js','utf8');if(!/(require|from)\s*\(?['\x22][.\/]+time-api/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：node --test __tests__/iso.test.js 子进程 exit 0（runtime 真跑通）
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 30 node --test scripts/harness-dogfood/__tests__/iso.test.js > /tmp/iso-nodetest.log 2>&1 && grep -qE '^# pass [1-9]' /tmp/iso-nodetest.log"

- [ ] [ARTIFACT] PRD 兼容层：scripts/harness-dogfood/__tests__/not-found.test.js 文件存在
  Test: test -f scripts/harness-dogfood/__tests__/not-found.test.js

- [ ] [ARTIFACT] PRD 兼容层：__tests__/not-found.test.js 使用 Node 内置 node:test
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/not-found.test.js','utf8');if(!/node:test/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：__tests__/not-found.test.js 真实 require time-api.js
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/not-found.test.js','utf8');if(!/(require|from)\s*\(?['\x22][.\/]+time-api/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：node --test __tests__/not-found.test.js 子进程 exit 0
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 30 node --test scripts/harness-dogfood/__tests__/not-found.test.js > /tmp/nf-nodetest.log 2>&1 && grep -qE '^# pass [1-9]' /tmp/nf-nodetest.log"

- [ ] [ARTIFACT] 仓库根 vitest 配置文件存在（`vitest.config.ts` 或 `vitest.config.mjs` 或 `vitest.config.js` 或 `vitest.workspace.ts`）
  Test: bash -c "test -f vitest.config.ts || test -f vitest.config.mjs || test -f vitest.config.js || test -f vitest.workspace.ts"

- [ ] [ARTIFACT] 仓库根 vitest 配置 include 含 `sprints/tests`（字面量匹配；即便宽松用 `**/*.test.ts` 也必须显式列 sprints 路径，锁契约）
  Test: node -e "const fs=require('fs');const files=['vitest.config.ts','vitest.config.mjs','vitest.config.js','vitest.workspace.ts'];let found=false;for(const f of files){if(fs.existsSync(f)){const c=fs.readFileSync(f,'utf8');if(/include/.test(c)&&/sprints\/tests/.test(c)){found=true;break}}}if(!found){console.error('FAIL: 仓库根 vitest 配置未显式含 include + sprints/tests 路径');process.exit(1)}"

- [ ] [ARTIFACT] 仓库根 vitest 配置能被 vitest 1.x 正确解析（`vitest --config <file> run --reporter=default --run-help` 样板不适用，改跑真实发现）：`vitest run sprints/tests/ws1/` stderr 不含 "No test files found"
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws1/ > /tmp/ws1-disc.stdout 2> /tmp/ws1-disc.stderr; if grep -q 'No test files found' /tmp/ws1-disc.stderr /tmp/ws1-disc.stdout; then echo 'FAIL: vitest 未发现 sprints/tests/ws1/';cat /tmp/ws1-disc.stderr;exit 1;fi"

- [ ] [ARTIFACT] `vitest run sprints/tests/ws1/` stdout 明确出现 `sprints/tests/ws1/iso.test.ts` 路径（证据：vitest 扫到了本 WS 测试文件）
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws1/ > /tmp/ws1-disc.stdout 2>&1 || true; grep -q 'sprints/tests/ws1/iso.test.ts' /tmp/ws1-disc.stdout"

- [ ] [ARTIFACT] `vitest run sprints/tests/ws1/` 最终 `Test Files` 摘要行显示 1 个 test file、`Tests` 摘要行显示 9 个 test（Red 阶段全 failed，Green 阶段全 passed；数量必须匹配本合同）
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws1/ > /tmp/ws1-disc.stdout 2>&1 || true; grep -qE 'Test Files[[:space:]]+[0-9]+[[:space:]]+(failed|passed)[[:space:]]*\\(1\\)' /tmp/ws1-disc.stdout && grep -qE 'Tests[[:space:]]+[0-9]+[[:space:]]+(failed|passed)[[:space:]]*\\(9\\)' /tmp/ws1-disc.stdout"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/iso.test.ts`，共 9 个 it（Round 4：删 WS1 独立态 routes 检查修正致命正确性 bug），覆盖：
- GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式
- GET /iso 的 Content-Type 为 application/json
- GET /iso 的 iso 字段对应时间与当前时间相差不超过 5 秒
- GET /unknown-xyz 返回 404 且 body 为 {error:"not_found"}
- POST /iso 返回 405 且 body 为 {error:"method_not_allowed"}
- createServer(0) 返回已监听的 server，address().port 为正整数
- time-api.js 源码不含 timezone/unix 相关字面量（物理隔离契约·全时态合同）
- PRD 兼容层 runtime：node --test __tests__/iso.test.js exit 0
- PRD 兼容层 runtime：node --test __tests__/not-found.test.js exit 0
