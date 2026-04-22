# Contract DoD — Workstream 3: `/unix` 端点

**范围**: 在 `scripts/harness-dogfood/time-api.js` 的 `routes` 锚点（WS1 已定义）追加 `routes['/unix'] = handler`，handler 返回 `{unix: Math.floor(Date.now()/1000)}`。新建 `scripts/harness-dogfood/__tests__/unix.test.js` 作为 PRD 兼容层占位。**不得**修改 WS1 / WS2 已写代码。
**大小**: S（time-api.js diff 约 6-10 行 + 1 个 PRD 兼容层测试文件）
**依赖**: Workstream 1（需要 routes 锚点 + handler 骨架存在）；与 WS2 **无顺序耦合**

## ARTIFACT 条目

- [ ] [ARTIFACT] time-api.js 含 `/unix` 路由字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]\/unix['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 `Math.floor(Date.now()/1000)` 秒级转换（杜绝毫秒级实现）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/Math\.floor\s*\(\s*Date\.now\s*\(\s*\)\s*\/\s*1000\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 `unix` 响应字段名
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]unix['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 的 routes 仍含 `/iso` 键（WS1 骨架未被 WS3 破坏，append-only 存续断言）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]\/iso['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 仍含 `not_found` 兜底（WS3 未破坏 WS1 的 404 兜底）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/not_found/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：scripts/harness-dogfood/__tests__/unix.test.js 文件存在
  Test: test -f scripts/harness-dogfood/__tests__/unix.test.js

- [ ] [ARTIFACT] PRD 兼容层：__tests__/unix.test.js 至少含 1 个 it 断言
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/unix.test.js','utf8');const m=c.match(/\bit\s*\(/g);if(!m||m.length<1)process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws3/）

见 `sprints/tests/ws3/unix.test.ts`，共 5 个 it，覆盖：
- GET /unix 返回 200 且 unix 字段为正整数
- GET /unix 的 unix 字段与当前秒级时间戳相差不超过 5 秒
- GET /unix 的 unix 字段不是毫秒级（不应比当前秒时间戳大三位数以上）
- GET /unix 的 Content-Type 为 application/json
- routes["/unix"] 为 handler 函数（WS3 在 WS1 骨架上 append-only 追加）
