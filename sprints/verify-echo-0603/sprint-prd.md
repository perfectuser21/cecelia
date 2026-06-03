# Sprint PRD — GET /api/brain/harness/echo 路由实现

## OKR 对齐

- **对应 KR**：Harness Pipeline 可验证性
- **当前进度**：进行中
- **本次推进预期**：新增可测试的 echo 端点，验证路由注册机制正常

## 背景

Brain harness 路由模块需要一个可由 evaluator 调用的 echo 端点，用于验证路由文件创建与注册流程完整性。该路由必须存在于真实路由文件中（非仅测试 mock）。

## Golden Path（核心场景）

调用方从 `GET /api/brain/harness/echo?msg=hello` → Brain 解析 query param `msg` → 返回 `{ok: true, echo: "hello"}`

具体：
1. 触发：`curl "localhost:5221/api/brain/harness/echo?msg=hello"`
2. Brain 路由 `packages/brain/src/routes/harness.routes.js` 处理请求，读取 `req.query.msg`
3. 返回 JSON `{"ok": true, "echo": "hello"}`，HTTP 200

## Response Schema

| 字段 | 类型 | 约束 |
|------|------|------|
| `ok` | boolean | 恒为 `true` |
| `echo` | string | 等于请求 `msg` query param 原值 |

## 边界情况

- `msg` 为空字符串：返回 `{ok: true, echo: ""}` — 不报错
- `msg` 未传：返回 `{ok: true, echo: ""}` 或 `{ok: true, echo: null}` — [ASSUMPTION: 空值不视为错误]
- `msg` 含特殊字符（空格/中文）：URL decode 后原样返回

## 范围限定

**在范围内**：
- 新建 `packages/brain/src/routes/harness.routes.js`，注册 `GET /echo` 子路由
- Brain server 挂载该路由到 `/api/brain/harness`
- smoke 脚本验证端点可达且 echo 字段正确

**不在范围内**：
- 认证/鉴权
- 日志记录
- 修改现有 `harness.js` / `harness-callback.js` / `harness-interrupts.js` 逻辑

## 假设

- [ASSUMPTION: Brain server 已有挂载 `/api/brain/harness` 的机制，或可在 server.js 中添加 require]
- [ASSUMPTION: `msg` 未传时以空字符串处理，不返回 4xx]

## 预期受影响文件

- `packages/brain/src/routes/harness.routes.js`：新建，实现 GET /echo 路由
- `packages/brain/src/server.js`：挂载 harness.routes.js（如尚未挂载）

## E2E 验收

```bash
#!/bin/bash
set -e
# 假设 Brain 已运行在 localhost:5221
RESP=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=hello")
echo "$RESP" | jq -e '.ok == true' > /dev/null
echo "$RESP" | jq -e '.echo == "hello"' > /dev/null
echo "✅ /api/brain/harness/echo 验证通过: $RESP"
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 路由层，无 UI 交互
## target_environment: local_api
## target_environment_reason: Brain 内部端点，curl localhost:5221 本地验证
## journey_id: cecelia-harness-pipeline
## step_id: verify-echo-0603
