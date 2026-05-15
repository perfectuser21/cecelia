---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: /ping 路由 + 生产单元测试

**范围**:
- `packages/brain/src/routes/status.js` 新增 `GET /ping`（返 `{pong:true,ts:<unix>}`）+ `ALL /ping`（405，error: "Method Not Allowed"）
- `packages/brain/src/__tests__/ping.test.js` 新建生产单元测试（Generator 产出物，实现后创建）

**大小**: S（路由 ~25 行 + 测试 ~80 行，合计 ~105 行）
**依赖**: 无

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/routes/status.js` 含 `router.get('/ping'` 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes(\"router.get('/ping'\"))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/routes/status.js` 含 `router.all('/ping'` 路由（405 处理）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes(\"router.all('/ping'\"))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/src/__tests__/ping.test.js` 生产单元测试文件存在（Generator 产出物）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/ping.test.js')"
