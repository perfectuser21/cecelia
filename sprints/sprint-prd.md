# Sprint PRD — playground GET /echo 端点（B39 harness pipeline 端到端验证）

## OKR 对齐

- **对应 KR**：Harness Pipeline 端到端可运行验证
- **当前进度**：B39 .brain-result.json 协议已实现
- **本次推进预期**：/echo 端点作为最简冒烟用例，验证 planner→proposer→generator→evaluator 全链路

## 背景

B39 重构了 Brain 的 .brain-result.json 文件协议，harness 现需一个真实的 playground 端点验证整条流水线端到端可运行。

## Golden Path（核心场景）

调用方从 `GET /echo?msg=hello` 入口 → playground 读取 `msg` 参数原样回显 → 出口返回 `{"msg":"hello"}`（HTTP 200）。

1. 调用 `GET /echo?msg=<任意字符串>`
2. playground/server.js 读取 `req.query.msg` 并构造响应
3. HTTP 200，body 为 `{"msg":"<原值>"}`

## Response Schema

### Endpoint: GET /echo

**Query Parameters**：
- `msg` (string, 必填): 原样回显的消息字符串
- **禁用 query 名**: `message`/`text`/`content`/`input`/`m`/`q`/`data`
- **强约束**: 缺失 `msg` 时返回 HTTP 400

**Success (HTTP 200)**：
```json
{"msg": "hello"}
```
- `msg` (string, 必填): 原样等于 query param 值
- **禁用响应字段名**: `message`/`text`/`echo`/`result`/`data`/`body`/`content`
- **Schema 完整性**: 顶层 keys 完全等于 `["msg"]`，禁止多余字段

**Error (HTTP 400)**：
```json
{"error": "msg 是必填参数"}
```
- 必有 `error` key，禁用 `message`/`reason`/`msg` 替代

## 边界情况

- `msg` 缺失 → HTTP 400 `{"error": "msg 是必填参数"}`
- `msg` 为空字符串 → HTTP 200 `{"msg": ""}` （允许空值回显）

## 范围限定

**在范围内**：`playground/server.js` 新增 `GET /echo` 路由；`playground/tests/server.test.js` 新增测试用例
**不在范围内**：鉴权、限流、持久化、Brain API 路由变更、其他端点改动

## 假设

- [ASSUMPTION: playground 使用 `PLAYGROUND_PORT` 环境变量，默认 3000]
- [ASSUMPTION: vitest 测试直接扩充现有 `playground/tests/server.test.js`]

## E2E 验收

```bash
# 使用 playground 自己的端口验证
cd /workspace/playground
PLAYGROUND_PORT=3001 node server.js &
SPID=$!
sleep 2
curl -sf "localhost:3001/echo?msg=hello" | jq -e '.msg == "hello"'
curl -sf "localhost:3001/echo?msg=world" | jq -e '.msg == "world"'
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3001/echo")
[ "$STATUS" = "400" ] || { echo "FAIL: 缺 msg 应返 400，实得 $STATUS"; kill $SPID; exit 1; }
kill $SPID
echo "✅ playground /echo 验证通过"
```

## 预期受影响文件

- `playground/server.js`: 新增 `GET /echo` 路由
- `playground/tests/server.test.js`: 新增 /echo 测试用例

## journey_type: dev_pipeline
## journey_type_reason: harness pipeline 端到端验证用例，落在 playground（非 apps/dashboard 或 brain 业务逻辑）
