# Contract DoD — Workstream 2: `/timezone` 端点

**范围**: 在 `scripts/harness-dogfood/time-api.js` 的 `routes` 锚点（WS1 已定义）追加 `routes['/timezone'] = handler`，handler 返回 `{timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`。新建 `scripts/harness-dogfood/__tests__/timezone.test.js` 作为 PRD 兼容层占位。**不得**修改 WS1 已写的骨架代码。
**大小**: S（time-api.js diff 约 6-10 行 + 1 个 PRD 兼容层测试文件）
**依赖**: Workstream 1（需要 routes 锚点 + handler 骨架存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] time-api.js 含 `/timezone` 路由字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]\/timezone['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 使用 Intl.DateTimeFormat 读取时区
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/Intl\.DateTimeFormat/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 `timezone` 响应字段名
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]timezone['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 的 routes 仍含 `/iso` 键（WS1 骨架未被 WS2 破坏，append-only 存续断言）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]\/iso['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 仍含 `not_found` 兜底（WS2 未破坏 WS1 的 404 兜底）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/not_found/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：scripts/harness-dogfood/__tests__/timezone.test.js 文件存在
  Test: test -f scripts/harness-dogfood/__tests__/timezone.test.js

- [ ] [ARTIFACT] PRD 兼容层：__tests__/timezone.test.js 至少含 1 个 it 断言
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/timezone.test.js','utf8');const m=c.match(/\bit\s*\(/g);if(!m||m.length<1)process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws2/）

见 `sprints/tests/ws2/timezone.test.ts`，共 4 个 it，覆盖：
- GET /timezone 返回 200 且 timezone 字段为非空字符串
- GET /timezone 返回的 timezone 等于进程 Intl.DateTimeFormat 的 timeZone（UTC 兜底）
- GET /timezone 的 Content-Type 为 application/json
- routes["/timezone"] 为 handler 函数（WS2 在 WS1 骨架上 append-only 追加）
