# Contract DoD — Workstream 2: `/timezone` 端点

**范围**: 在 `scripts/harness-dogfood/time-api.js` 的 handler 中为 `/timezone` 路径返回 `{timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`。
**大小**: S（diff 约 5-10 行）
**依赖**: Workstream 1（handler 骨架必须已存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] time-api.js 含 `/timezone` 路由字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]\/timezone['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 使用 Intl.DateTimeFormat 读取时区
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/Intl\.DateTimeFormat/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 timezone 响应字段名
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]timezone['\x22]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws2/）

见 `sprints/tests/ws2/timezone.test.ts`，覆盖：
- GET /timezone 返回 200 且 timezone 字段为非空字符串
- GET /timezone 的 timezone 字段等于 Intl.DateTimeFormat().resolvedOptions().timeZone 或 UTC
- GET /timezone 的 Content-Type 为 application/json
