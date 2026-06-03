# Sprint PRD — GET /api/brain/harness/ping 端点

## OKR 对齐

- **对应 KR**：Harness Pipeline 可验证性 KR
- **当前进度**：N/A（基础设施验证端点）
- **本次推进预期**：提供标准 ping 探针，供 harness evaluator 验证 Brain API 可达性

## 背景

Harness evaluator 在每次 sprint 验收时需要一个轻量端点来确认 Brain API 存活。现有 `/api/brain/harness/` 路由已注册，缺少标准 ping 探针。

## Golden Path（核心场景）

系统从 `GET /api/brain/harness/ping` 入口 → Brain harness 路由处理 → 返回 JSON 响应

具体：
1. 调用方发送 `GET /api/brain/harness/ping`（无鉴权要求）
2. Brain 路由在 `packages/brain/src/routes/harness.js` 中处理请求
3. 返回 HTTP 200，body 为 `{"ok": true, "ts": "<ISO 8601 时间戳>"}`

## Response Schema

```
GET /api/brain/harness/ping
→ 200 OK
{
  "ok": true,          // boolean，固定为 true
  "ts": string         // ISO 8601 格式，如 "2026-06-03T10:00:00.000Z"
}
```

## 边界情况

- 无请求参数，无 body，无副作用
- ts 字段为服务器处理时刻的 ISO 时间戳（`new Date().toISOString()`）

## 范围限定

**在范围内**：
- `packages/brain/src/routes/harness.js` 新增 `GET /ping` 路由
- 单元测试：断言响应状态 200、`ok === true`、`ts` 为有效 ISO 字符串

**不在范围内**：
- 数据库读写
- 鉴权中间件改动
- 其他路由文件修改
- Dashboard UI 变更

## 假设

- [ASSUMPTION: Brain server 保持现有 `/api/brain/harness` 路由挂载，不需要改 server.js]
- [ASSUMPTION: 单元测试使用现有 `packages/brain/src/routes/__tests__/` 或同级测试目录]

## E2E 验收

```bash
# 启动 Brain（已运行则跳过），验证端点可达
curl -sf http://localhost:5221/api/brain/harness/ping \
  | jq -e '.ok == true and (.ts | type == "string")' \
  && echo "✅ /api/brain/harness/ping 验证通过" \
  || { echo "❌ /api/brain/harness/ping 失败"; exit 1; }
```

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增 `GET /ping` handler
- `packages/brain/src/routes/__tests__/harness.ping.test.js`（或同目录）：新增单元测试

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/src/ 后端路由，无 UI 交互
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端端点，curl localhost:5221 本地验证即可
## journey_id: cecelia-harness-pipeline
## step_id: harness-verify-ping
