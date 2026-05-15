# Sprint Contract Draft (Round 2)

## Golden Path

[GET /echo?msg=hello] → [服务读取 msg 参数原样回显] → [HTTP 200 + {"echo": "hello"}]

边界：[GET /echo?msg=] → [回显空字符串] → [HTTP 200 + {"echo": ""}]

---

### Step 1: 客户端发起 GET /echo?msg=hello，服务回显

**可观测行为**: HTTP 200 + JSON body `{"echo": "hello"}`，response key 精确为 `echo`，值与 msg 参数值完全相同。

**验证命令**:
```bash
pkill -f "PLAYGROUND_PORT=3191" 2>/dev/null || true; sleep 1
cd /workspace/playground && PLAYGROUND_PORT=3191 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3191/echo?msg=hello")
echo "$RESP" | jq -e '.echo == "hello"' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
kill $SPID 2>/dev/null
```

**硬阈值**: `.echo == "hello"`，HTTP 200

---

### Step 2: 空字符串边界 GET /echo?msg=

**可观测行为**: HTTP 200 + `{"echo": ""}` — 值为空字符串（非 null、非 undefined）

**验证命令**:
```bash
pkill -f "PLAYGROUND_PORT=3192" 2>/dev/null || true; sleep 1
cd /workspace/playground && PLAYGROUND_PORT=3192 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3192/echo?msg=")
echo "$RESP" | jq -e '.echo == ""' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
kill $SPID 2>/dev/null
```

**硬阈值**: `.echo == ""`（空字符串，非 null）

---

### Step 3: Schema 完整性 — response 顶层 keys 精确等于 `["echo"]`

**可观测行为**: response body 仅含 `echo` 一个字段，不允许多余字段（含任何禁用 key）

**验证命令**:
```bash
pkill -f "PLAYGROUND_PORT=3193" 2>/dev/null || true; sleep 1
cd /workspace/playground && PLAYGROUND_PORT=3193 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3193/echo?msg=test")
echo "$RESP" | jq -e 'keys == ["echo"]' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
kill $SPID 2>/dev/null
```

**硬阈值**: `keys == ["echo"]`

---

### Step 4: 禁用字段反向检查

**可观测行为**: response 不含任何 PRD 禁用 key（`message`/`result`/`response`/`data`/`output`/`text`/`reply`/`body`/`msg`）

**验证命令**:
```bash
pkill -f "PLAYGROUND_PORT=3194" 2>/dev/null || true; sleep 1
cd /workspace/playground && PLAYGROUND_PORT=3194 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3194/echo?msg=hello")
echo "$RESP" | jq -e 'has("message") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
echo "$RESP" | jq -e 'has("response") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
echo "$RESP" | jq -e 'has("output") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
echo "$RESP" | jq -e 'has("text") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
echo "$RESP" | jq -e 'has("reply") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
echo "$RESP" | jq -e 'has("body") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
echo "$RESP" | jq -e 'has("msg") | not' >/dev/null 2>&1 || { kill $SPID 2>/dev/null; exit 1; }
kill $SPID 2>/dev/null
```

**硬阈值**: 所有 9 个禁用字段均不存在

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 前置清理：防止残留进程占用端口
pkill -f "PLAYGROUND_PORT=3195" 2>/dev/null || true
sleep 1

cd /workspace/playground

PLAYGROUND_PORT=3195 node server.js &
SPID=$!
sleep 2

cleanup() { kill $SPID 2>/dev/null || true; }
trap cleanup EXIT

# Step 1: 正常回显字段值
RESP=$(curl -fs "localhost:3195/echo?msg=hello")
echo "$RESP" | jq -e '.echo == "hello"' >/dev/null 2>&1 || { echo "FAIL: echo 字段值不匹配"; exit 1; }

# Step 2: 空字符串
RESP2=$(curl -fs "localhost:3195/echo?msg=")
echo "$RESP2" | jq -e '.echo == ""' >/dev/null 2>&1 || { echo "FAIL: 空字符串回显失败"; exit 1; }

# Step 3: Schema 完整性
echo "$RESP" | jq -e 'keys == ["echo"]' >/dev/null 2>&1 || { echo "FAIL: keys 完整性失败"; exit 1; }

# Step 4: 禁用字段反向（PRD 禁用 9 个 key）
for k in message result response data output text reply body msg; do
  echo "$RESP" | jq -e "has(\"$k\") | not" >/dev/null 2>&1 || { echo "FAIL: 禁用字段 $k 存在"; exit 1; }
done

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Risks

| ID | 风险 | 概率 | 缓解措施 |
|---|---|---|---|
| R1 | 端口 3191-3195 被其他进程占用，server.js 启动失败 | 中 | 每条验证命令前置 `pkill -f "PLAYGROUND_PORT=319X" 2>/dev/null \|\| true; sleep 1`，E2E 脚本 set -e 提前退出暴露问题 |
| R2 | `PLAYGROUND_PORT` env var 未生效（server.js 未读取该变量），服务仍监听默认端口导致验证命令端口不匹配 | 低 | Generator 在 commit 1 Red 阶段验证 `PLAYGROUND_PORT=3099 node server.js` 是否响应 `localhost:3099`；若失败需修 server.js 端口读取逻辑 |

---

## Workstreams

workstream_count: 1

### Workstream 1: GET /echo 端点实现

**范围**: `playground/server.js` 新增 GET /echo 路由；`sprints/tests/ws1/echo.test.js` vitest 单元测试
**大小**: S（< 100 行净增，≤ 2 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/echo.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | Red 阶段验证命令（机器可执行） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/echo.test.js` | echo 字段值、keys 完整性、禁用字段反向、空字符串边界 | `cd /workspace && npx vitest run sprints/tests/ws1/echo.test.js; [ $? -ne 0 ]`（exit≠0 证明测试真红） |
