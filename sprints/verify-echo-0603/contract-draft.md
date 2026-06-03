# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD字面/NEW_PATTERN）

### Endpoint: GET /api/brain/harness/echo

**Success (HTTP 200)**:
```json
{"ok": true, "echo": "<msg原值>"}
```
- `ok` (boolean, 必填): 恒为 `true` — 来源：PRD明确（"恒为 true"）
- `echo` (string, 必填): 等于请求 `msg` query param 原值 — 来源：PRD明确

**jq keys排序**: `["echo", "ok"]`（jq按字母序排列）

**Error (HTTP 4xx)**: N/A — PRD 定义 `msg` 未传时不视为错误，返回 200 + `echo:""`

---

## Risks

| # | 风险 | Mitigation |
|---|------|------------|
| R1 | Brain server 未运行（PRD [ASSUMPTION: Brain server 已运行]不满足），E2E 全部假绿 | E2E 脚本首先执行 `curl -sf localhost:5221/api/brain/health` 健康检查，失败立即 exit 1，阻断后续 curl 验证 |
| R2 | `/api/brain/harness` 路径未在 server.js 挂载，路由注册不可达（PRD [ASSUMPTION: /api/brain/harness 已挂载]不满足） | ARTIFACT 2 机检 `server.js` 包含 `harness.routes` 字符串，未挂载 → ARTIFACT FAIL，Generator 无法通过验收 |

---

## Golden Path

[调用方] → `GET /api/brain/harness/echo?msg=hello` → [harness.routes.js 处理] → `{"ok":true,"echo":"hello"}`

---

### Step 1: 调用 echo 端点，验证 happy path 响应

**来源**: `[FROM_PRD]` — PRD Golden Path 第1-3步直接定义（"`curl localhost:5221/api/brain/harness/echo?msg=hello` → 返回 `{"ok": true, "echo": "hello"}`"）

**可观测行为**: Brain 返回 HTTP 200 + JSON `{"ok":true,"echo":"hello"}`，所有字段值正确

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=hello") || { echo "FAIL: 端点未返回 200（路由未注册）"; exit 1; }
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok 字段不为 true"; exit 1; }
echo "$RESP" | jq -e '.echo == "hello"' || { echo "FAIL: echo 字段不等于 hello"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200，`ok=true`，`echo="hello"`

---

### Step 2: 验证 Response Schema 完整性（无多余字段、无漂移）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 generator 实现时返回 `{ok,echo,message}` 等多余字段或用 `result`/`msg` 替代 PRD 规定的字段名

**可观测行为**: 响应顶层 keys 完全等于 `["echo","ok"]`，无多余字段

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=hello") || { echo "FAIL: 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e 'keys == ["echo", "ok"]' || { echo "FAIL: schema keys 不匹配，存在多余或缺失字段"; exit 1; }
echo OK
```

**硬阈值**: `keys == ["echo", "ok"]`（精确匹配，顺序按 jq 字母序）

---

### Step 3: 验证边界情况 — msg 为空时不报错

**来源**: `[FROM_PRD]` — PRD 边界情况段明确定义（"`msg` 未传：返回 `{ok: true, echo: ""}` 或 `{ok: true, echo: null}` — [ASSUMPTION: 空值不视为错误]"）

**可观测行为**: 不传 `msg` 时 Brain 返回 HTTP 200，`ok` 仍为 `true`

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/echo") || { echo "FAIL: 空msg时端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: 空msg时ok字段不为true"; exit 1; }
ECHO_VAL=$(echo "$RESP" | jq -r '.echo')
[ "$ECHO_VAL" = "" ] || [ "$ECHO_VAL" = "null" ] || { echo "FAIL: 空msg时echo不为空字符串或null，实际: $ECHO_VAL"; exit 1; }
echo OK
```

**硬阈值**: HTTP 200，`ok=true`，`echo=""` 或 `echo=null`

---

## E2E 验收（final-e2e — target_environment: local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

# 0. 前置健康检查（R1 mitigation — Brain 未运行时此处 exit 1，阻断假绿）
curl -sf "localhost:5221/api/brain/health" > /dev/null || { echo "FAIL: Brain 未运行在 localhost:5221"; exit 1; }

# 1. Happy path — msg=hello
RESP=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=hello") || { echo "FAIL: 端点未返回 200（路由未注册）"; exit 1; }
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok 字段不为 true"; exit 1; }
echo "$RESP" | jq -e '.echo == "hello"' || { echo "FAIL: echo 字段不等于 hello"; exit 1; }
echo "$RESP" | jq -e 'keys == ["echo", "ok"]' || { echo "FAIL: schema keys 不匹配"; exit 1; }

# 2. 中文/特殊字符 msg（URL encode后）
RESP2=$(curl -sf "localhost:5221/api/brain/harness/echo?msg=%E6%B5%8B%E8%AF%95") || { echo "FAIL: 中文msg端点未返回200"; exit 1; }
echo "$RESP2" | jq -e '.echo == "测试"' || { echo "FAIL: 中文msg未正确decode返回"; exit 1; }

# 3. 边界：空msg
RESP3=$(curl -sf "localhost:5221/api/brain/harness/echo") || { echo "FAIL: 空msg时端点未返回200"; exit 1; }
echo "$RESP3" | jq -e '.ok == true' || { echo "FAIL: 空msg时ok不为true"; exit 1; }

echo "✅ /api/brain/harness/echo Golden Path 验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| echo 路由注册与响应 | `tests/harness-echo.test.ts` | ok字段/echo字段/keys完整性/空msg边界/中文URL decode | → 5 failures（harness.routes.js 不存在）|
