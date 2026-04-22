# Contract DoD — Workstream 3: `/unix` 端点

**范围**: 在 `scripts/harness-dogfood/time-api.js` 的 handler 中为 `/unix` 路径返回 `{unix: Math.floor(Date.now()/1000)}`。
**大小**: S（diff 约 5-10 行）
**依赖**: Workstream 1（handler 骨架必须已存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] time-api.js 含 `/unix` 路由字符串
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]\/unix['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 使用 Date.now 或 Math.floor 取秒级整数
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/Date\.now\(\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 含 unix 响应字段名
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/['\x22]unix['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 对 unix 做 Math.floor(... /1000) 的秒级转换
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/Math\.floor\s*\(\s*Date\.now\(\)\s*\/\s*1000\s*\)/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws3/）

见 `sprints/tests/ws3/unix.test.ts`，覆盖：
- GET /unix 返回 200 且 unix 字段为正整数
- GET /unix 的 unix 字段与当前秒级时间戳相差不超过 5 秒
- GET /unix 的 Content-Type 为 application/json
