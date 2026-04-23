# Contract DoD — Workstream 1: GET /api/brain/time 路由 + 注册 + 文档 + 单元测试

**范围**: 新增 `packages/brain/src/routes/time.js` handler；在 Brain server 注册使 `/api/brain/time` 活跃；新增 `packages/brain/src/__tests__/time.test.js` 单元测试；在 `docs/current/SYSTEM_MAP.md`（或 fallback `packages/brain/README.md`）追加路由条目。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由 handler 文件 `packages/brain/src/routes/time.js` 存在（PRD FR-001 + 预期受影响文件列表 mandate 此路径）
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/time.js')"

- [ ] [ARTIFACT] 单元测试文件 `packages/brain/src/__tests__/time.test.js` 存在（PRD FR-004 + 预期受影响文件列表 mandate 此路径；只断言文件存在，不锁断言形状/测试框架）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/time.test.js')"

- [ ] [ARTIFACT] Brain API 路由文档含 `/api/brain/time` 条目（PRD FR-005：优先 `docs/current/SYSTEM_MAP.md`，不存在则 fallback `packages/brain/README.md`，两个路径任一命中即通过）
  Test: node -e "const fs=require('fs');const p1='docs/current/SYSTEM_MAP.md';const p2='packages/brain/README.md';const hit=(fs.existsSync(p1)&&fs.readFileSync(p1,'utf8').includes('/api/brain/time'))||(fs.existsSync(p2)&&fs.readFileSync(p2,'utf8').includes('/api/brain/time'));if(!hit)process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/time.test.ts`，采用**真实 HTTP fetch** 断言（实现无关，外部可观测），覆盖：
- GET /api/brain/time 返回 HTTP 200 且 Content-Type 含 application/json
- 响应 body 顶层 key 严格等于 [iso, timezone, unix]
- iso 是合法 ISO 8601 字符串且可被 Date 解析
- timezone 是非空字符串
- unix 是合理范围内的正整数秒
- iso 与 unix 指向同一时刻（差值 ≤ 1 秒）
- 连续两次调用 timezone 完全一致
- 连续两次调用 unix 单调不减

## 本轮去除的 Round 1 ARTIFACT（Round 2 已删）

以下四条在 Round 1 写成 ARTIFACT 硬阈值，Round 2 依 Reviewer 意见**整体移除**，原因是它们锁死了内部 express API 形状（Router vs 主 app 直挂、导出形状、挂载语法），不属于"外部可观测产物"：

- ~~`packages/brain/src/routes/time.js` 含 `router.get('/time'` handler~~
- ~~`packages/brain/src/routes/time.js` 以 `export default router` 形式导出 Router~~
- ~~`packages/brain/server.js` 引入 `import timeRoutes from './src/routes/time.js'`~~
- ~~`packages/brain/server.js` 将 time 路由以 `app.use('/api/brain', timeRoutes)` 挂载~~

这些点的合规性由 `sprints/tests/ws1/time.test.ts` 的真实 HTTP 断言 **端到端验证**：只要 Brain 跑起来后 `GET /api/brain/time` 返回符合硬阈值的 200 响应，任何内部实现形态都合规。
