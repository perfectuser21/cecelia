# Contract DoD — Workstream 1: 时间查询路由模块 + Server 挂载 + 集成测试 + DevGate 脚本

**范围**: 新增 `packages/brain/src/routes/time.js`（三端点实现）+ `packages/brain/server.js` 挂载 + 集成测试 `packages/brain/src/__tests__/routes/time-routes.test.ts`（从合同 `sprints/tests/ws1/time-routes.test.ts` 原样复制，只允许调整 import 路径）+ `scripts/devgate/check-contract-test-copy.sh`（Round 3 新增，CI 机械化校验 hook）
**大小**: S（<150 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] `packages/brain/src/routes/time.js` 通过 `export default` 导出 express Router（源码含 `export default router` 或等价形式）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/export\s+default\s+router/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 从 express 导入 Router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/import\s*\{[^}]*Router[^}]*\}\s*from\s*['\"]express['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 注册 GET /iso 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/iso['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 注册 GET /unix 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/unix['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 注册 GET /timezone 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!/router\.get\(\s*['\"]\/timezone['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `time.js` 的 /timezone handler 含显式错误分支（try/catch 或 400 状态码常量）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/time.js','utf8');if(!((/\btry\s*\{/.test(c) && /\bcatch\s*\(/.test(c)) || /status\(\s*400\s*\)/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 导入 time 路由模块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/from\s*['\"]\.\/src\/routes\/time\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/server.js` 在 `/api/brain/time` 前缀挂载 time 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/time['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 合同测试被**原样复制**到 `packages/brain/src/__tests__/routes/time-routes.test.ts`（进 brain vitest.config.js 的 `include: 'src/**/*.test.*'` 范围，CI 会跑）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/routes/time-routes.test.ts')"

- [ ] [ARTIFACT] 实现测试文件与合同测试的 `it()` 标题**集合严格相等**（数量相等、每个标题在对端出现，避免 Generator"假 copy + 少写/换名"规避 Reviewer 约束）【Round 3 主校验：保留 Round 2 的内嵌 node -e 命令作为二重保险】
  Test: node -e "const fs=require('fs');const contract=fs.readFileSync('sprints/tests/ws1/time-routes.test.ts','utf8');const impl=fs.readFileSync('packages/brain/src/__tests__/routes/time-routes.test.ts','utf8');const extract=(s)=>Array.from(s.matchAll(/\bit\(\s*['\"]([^'\"]+)['\"]/g)).map(m=>m[1]);const a=extract(contract).sort();const b=extract(impl).sort();if(a.length!==b.length){console.error('it count mismatch: contract='+a.length+' impl='+b.length);process.exit(1)}for(let i=0;i<a.length;i++){if(a[i]!==b[i]){console.error('it title mismatch at index '+i+': contract='+JSON.stringify(a[i])+' impl='+JSON.stringify(b[i]));process.exit(1)}}"

- [ ] [ARTIFACT] 实现测试文件含 26 个 `it(` 调用（Round 3 冻结数量，低于即漏测 BEHAVIOR）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/routes/time-routes.test.ts','utf8');const n=Array.from(c.matchAll(/\bit\(/g)).length;if(n!==26){console.error('expected 26 it(), got '+n);process.exit(1)}"

- [ ] [ARTIFACT] 实现测试文件位于 brain vitest `include` 匹配范围（`packages/brain/src/**/*.test.*`），从而 `npm test -w packages/brain` 会收录
  Test: bash -c 'test -f packages/brain/src/__tests__/routes/time-routes.test.ts'

- [ ] [ARTIFACT] 合同测试文件本身保留在 `sprints/tests/ws1/time-routes.test.ts`（不被移动/删除，作为 canonical truth）
  Test: node -e "require('fs').accessSync('sprints/tests/ws1/time-routes.test.ts')"

- [ ] [ARTIFACT] `scripts/devgate/check-contract-test-copy.sh` 存在且具有可执行权限（Round 3 新增：CI 机械化校验 hook，实现合同与实现测试 `it()` 集合等价的独立 shell 校验；mismatch 时非 0 退出码，输出含 `mismatch` 或 `diff` 关键字）
  Test: bash -c 'test -x scripts/devgate/check-contract-test-copy.sh'

- [ ] [ARTIFACT] 运行 `scripts/devgate/check-contract-test-copy.sh` 在合同与实现 `it()` 集合一致时返回 0（Round 3 新增：端到端调用 CI hook，让 Reviewer 一条命令验通）
  Test: bash scripts/devgate/check-contract-test-copy.sh

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/，CI 复制体在 packages/brain/src/__tests__/routes/）

见 `sprints/tests/ws1/time-routes.test.ts`，26 个 it 覆盖（Round 3 冻结数量）：

**GET /iso**（6 个）:
- returns HTTP 200
- body.iso is a non-empty string
- body.iso matches strict ISO 8601 UTC format with .sss ms precision
- body.iso is parseable by Date.parse to a finite number
- body.iso is within 10 seconds of current server time
- body.iso ends with Z (UTC marker)

**GET /unix**（4 个）:
- returns HTTP 200
- body.unix is a number
- body.unix is an integer (Number.isInteger true)
- body.unix is within 5 seconds of current server Unix time

**GET /timezone 合法**（8 个）:
- returns HTTP 200 for tz=Asia/Shanghai
- body.tz equals Asia/Shanghai
- body.iso matches strict ISO with +08:00 offset and .sss ms
- body.iso for Asia/Shanghai is parseable and within 10 seconds of server time
- body.iso for America/New_York ends with -04:00 (DST active on 2026-04-23，测试期间系统时钟冻结到该日期)
- body.iso for tz=UTC ends with +00:00 (not Z)
- body.tz equals UTC for tz=UTC
- body.iso for tz=Etc/UTC ends with +00:00 (not Z)

**GET /timezone 错误**（8 个）:
- returns HTTP 400 for invalid tz=Mars/Olympus
- invalid tz body.error is a non-empty string
- returns HTTP 400 when tz query is missing
- missing tz body.error mentions tz (case-insensitive)
- GET /timezone?tz=asia/shanghai (lowercase) returns HTTP 400 — tz match is case-sensitive
- GET /timezone?tz=Asia/Shanghai&tz=UTC (duplicated tz) returns HTTP 400 — tz must be a single string ← **Round 3 新增**
- GET /timezone duplicated tz body.error explains tz must be a single string value ← **Round 3 新增**
- invalid tz request does not crash server — subsequent /iso still returns 200

## Round 3 增量摘要

| 新增 ARTIFACT | 目的 |
|---|---|
| A15: `scripts/devgate/check-contract-test-copy.sh` 存在且可执行 | 回应 Reviewer Round 2 反馈 —— 让测试等价性校验有独立 CI hook |
| A16: 运行该脚本在一致时 exit 0 | 端到端 smoke test，保证 hook 真的能被 Reviewer / CI 调用 |

| 修改 ARTIFACT | 说明 |
|---|---|
| A12: 预期 `it(` 数量 24 → 26 | duplicated tz 新增 2 个 BEHAVIOR |

| 保留 ARTIFACT（不变） | 说明 |
|---|---|
| A11: 内嵌 `node -e` 校验 it 集合等价 | 作为**主校验** + 二重保险，防 Generator 写错 devgate 脚本后漂移漏检 |
| A13: 实现测试在 brain vitest include 范围 | 保证 `npm test -w packages/brain` 会收录 |
| A14: 合同文件保留在 sprints/tests/ws1/ | canonical truth 不可移动 |
