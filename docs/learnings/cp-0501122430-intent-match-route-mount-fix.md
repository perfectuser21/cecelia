## intent-parse smoke_cmd 修正（2026-05-01）

### 根本原因

Migration 250 的 intent-parse `smoke_cmd` 写的是文件存在检查（`node -e "accessSync(...)"`），
不是真实端点测试。同时 `cecelia-smoke-audit.sh` 中测试的 URL 是 `/api/brain/intent-match/match`
（错误），实际路由挂载在 `/api/brain/intent`（`server.js` 第 243 行：
`app.use('/api/brain/intent', intentMatchRoutes)`）。

误判为"P1 bug 路由未挂载"，实际路由早已正确挂载，只是 smoke 脚本写错了 URL。

额外细节：intent-match 端点的请求字段是 `query`（不是 `text`），响应含 `total` 字段。

### 下次预防

- [ ] 写 smoke_cmd 时必须先 `curl -v` 确认 URL 路径，不能凭印象或文件名推断
- [ ] server.js 的路由前缀与路由文件内部 path 合并后才是完整 URL：
      `app.use('/api/brain/intent', router)` + `router.post('/match', ...)` = `/api/brain/intent/match`
- [ ] 文件存在检查（`accessSync`）不算真实 smoke_cmd，必须测实际 HTTP 端点
- [ ] 请求字段名必须从路由源码确认（`req.body.query`），不能猜测（`text`/`input`/`message`）
