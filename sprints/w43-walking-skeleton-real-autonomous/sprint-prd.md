# Sprint PRD — /ping Endpoint 实现（Autonomous Journey 真全自动闭环验证）

## OKR 对齐

- **对应 KR**：KR-Walking-Skeleton（Cecelia Autonomous Journey 端到端闭环）
- **本次推进预期**：验证 task.status=completed + PR 真合 main 完整链路跑通

## 背景

22 个 P1 fix 已合 main。需一个 `/ping` endpoint 作为本次真验载体，验证全自动闭环。

## Golden Path（核心场景）

调用方 `GET /api/brain/ping` → Brain 路由处理（无 DB 操作）→ 返回 `{pong:true, ts:<unix>}`

1. 客户端 `GET /api/brain/ping`（无请求体、无认证）
2. Brain 构造响应，不访问数据库
3. HTTP 200，body 恰好含 `pong: true` 和 `ts: <Unix seconds>`

## Response Schema

### Endpoint: GET /api/brain/ping

**Query Parameters**: 无

**Success (HTTP 200)**:
```json
{"pong": true, "ts": 1747123456}
```
- `pong` (boolean): 固定 `true`，禁用 `ok`/`alive`/`status`
- `ts` (number integer): `Math.floor(Date.now()/1000)`，禁用毫秒或字符串

**Error (HTTP 405)**: `{"error": "Method Not Allowed"}`

**Schema 完整性**: 顶层 keys 必须恰好 `["pong", "ts"]`，禁用 `timestamp`/`result`/`data`/`ok`

## 边界情况

- `POST /api/brain/ping` → 405
- 不得被 `ping-extended` 路由拦截（两条独立路由）

## 范围限定

**在范围内**: status.js 加 `GET /ping` + `ALL /ping`（405）+ 单元测试
**不在范围内**: 数据库操作、认证、前端变更、ping-extended 修改

## 假设

- [ASSUMPTION: 完整路径 `/api/brain/ping`，挂载前缀同 ping-extended]
- [ASSUMPTION: ts 用 Unix seconds（非毫秒）]

## 预期受影响文件

- `packages/brain/src/routes/status.js`: 新增 GET /ping + ALL /ping
- `packages/brain/src/__tests__/ping.test.js`: 新增单元测试

## journey_type: autonomous
## journey_type_reason: 只涉及 packages/brain/ 后端路由新增，无前端无 bridge
