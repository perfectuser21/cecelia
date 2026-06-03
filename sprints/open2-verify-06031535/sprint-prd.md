# Sprint PRD — GET /api/brain/harness/healthz 端点

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测性
- **当前进度**：已有 /ping（轻量探活），缺 /healthz（标准服务健康检查端点）
- **本次推进预期**：新增标准 healthz 端点，补充 supertest 单测覆盖

## 背景

harness.js 已有 `/ping` 端点（简单探活），但缺少包含服务标识与时间戳的标准健康检查端点。本次在同文件新增 `GET /api/brain/harness/healthz`，返回结构化响应，并附 supertest 单测。

## Golden Path（核心场景）

调用方（CI / 监控 / Evaluator）从 `GET /api/brain/harness/healthz` → 收到 `200 OK` 响应体 → 断言字段 `ok/service/ts` 正确。

具体：
1. 调用方发起 `GET /api/brain/harness/healthz`
2. 服务返回 HTTP 200，响应体 `{ ok: true, service: 'harness', ts: <ISO8601> }`
3. 调用方可断言：`ok === true`、`service === 'harness'`、`ts` 符合 ISO8601 格式（`new Date(ts)` 不为 NaN）

## Response Schema

| 字段 | 类型 | 约束 |
|------|------|------|
| ok | boolean | 必须为 `true` |
| service | string | 必须为字面量 `"harness"` |
| ts | string | ISO8601 格式，`new Date(ts)` 有效 |

HTTP 状态码：200

## 边界情况

- 服务正常时始终返回 200（不做 DB 探测，纯静态响应）
- ts 使用服务端当前时间（`new Date().toISOString()`），不接受外部参数

## 范围限定

**在范围内**：
- `packages/brain/src/routes/harness.js` 新增 `GET /healthz` 路由处理器
- 对应 supertest 单测验证 200 / ok / service / ts

**不在范围内**：
- DB 健康探测
- 修改现有 `/ping` 逻辑
- Dashboard UI 变更

## 假设

- [ASSUMPTION: /healthz 与 /ping 同级挂载，最终路径为 /api/brain/harness/healthz]
- [ASSUMPTION: supertest 单测写在 packages/brain/src/routes/__tests__/ 或 packages/brain/tests/ 下]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增 GET /healthz 路由
- `packages/brain/tests/routes/harness-healthz.test.js`（或同目录 __tests__）：supertest 单测

## E2E 验收

```bash
# 启动 Brain，验证 healthz 端点返回正确结构
RESULT=$(curl -sf localhost:5221/api/brain/harness/healthz)
echo "$RESULT" | jq -e '.ok == true' || { echo "FAIL: ok 不为 true"; exit 1; }
echo "$RESULT" | jq -e '.service == "harness"' || { echo "FAIL: service 字段错误"; exit 1; }
TS=$(echo "$RESULT" | jq -r '.ts')
node -e "const d=new Date('$TS'); if(isNaN(d.getTime())) process.exit(1)" || { echo "FAIL: ts 不是有效 ISO8601"; exit 1; }
echo "✅ /api/brain/harness/healthz 验证通过"
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain 后端路由新增，无前端交互，无外部 agent 协议变更
## target_environment: local_api
## target_environment_reason: 验证对象为 localhost:5221 Brain API，直接 curl + supertest 即可
## journey_id: 926779b5-014a-48e1-8aac-af27b907f94f
## step_id: open2-verify-06031535
