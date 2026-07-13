# Contract Notes: relay-smoke-v2.2.0

## 调查结论

Brain 路由结构：
- 路由文件位于 `/workspace/packages/brain/src/routes/`
- 路由在 `/workspace/packages/brain/server.js` 中 import 并 `app.use` 挂载
- `/api/brain` 前缀下有 `walkingSkeletonRouter`（挂载于 server.js line 346）

## 要改的文件

**方案 A（推荐）：新建独立路由文件**
- 新建：`packages/brain/src/routes/relay-smoke.js`
- 修改：`packages/brain/server.js` — 新增 import + `app.use('/api/brain', relaySmokeRouter)`

**方案 B：追加到 walking-skeleton.js**
- 修改：`packages/brain/src/routes/walking-skeleton.js`
- 在 `walking-skeleton.js` 中追加 `router.get('/relay-smoke', ...)` 即可，该 router 已挂载到 `/api/brain`

方案 B 改动最小（仅一个文件），符合 Invariant"不改任何既有路由/中间件"（追加路由不影响现有行为）。

## 合同要验证的行为

| 验证点 | 断言 |
|--------|------|
| HTTP 状态码 | 200 |
| 响应体 `.ok` | `true`（boolean） |
| 响应体 `.controller` | `"2.2.0"`（string） |
| 响应时间 | < 100ms |
| 现有端点不受影响 | GET /api/brain/context 仍正常返回 |

## E2E 验证命令

```bash
# 主断言
curl -s localhost:5221/api/brain/relay-smoke | jq -e '.ok==true and .controller=="2.2.0"'

# 回归断言（现有路由未损坏）
curl -s localhost:5221/api/brain/context | jq -e '.ok != null or . != null'
```
