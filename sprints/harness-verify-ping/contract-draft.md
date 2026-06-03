# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD 字面）

### Endpoint: GET /api/brain/harness/ping

**Success (HTTP 200)**:
```json
{"ok": true, "ts": "<ISO 8601 string>"}
```
- `ok` (boolean, 必填): 来源——PRD `## Response Schema` 明确定义，固定值 `true`
- `ts` (string, 必填): 来源——PRD `## Response Schema` 明确定义，`new Date().toISOString()` 格式，如 `"2026-06-03T10:00:00.000Z"`

**禁用字段名**: `status`, `alive`, `pong`, `timestamp`（语义等价词，PRD 未授权，禁止出现在响应体）

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

## Golden Path

[客户端 GET] → [Brain harness 路由] → [返回 200 JSON]

---

### Step 1: 客户端发送 GET /api/brain/harness/ping（无鉴权）

**来源**: `[FROM_PRD]` — PRD § "Golden Path（核心场景）" 第 1 条直接定义

**可观测行为**: HTTP 响应状态码为 200，Body 为 JSON 对象

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/harness/ping)
[ "$CODE" = "200" ] || { echo "FAIL: 期望 200，实际 $CODE"; exit 1; }
echo "OK: HTTP 200"
```

**硬阈值**: HTTP 200

---

### Step 2: 响应体 ok 字段固定为 boolean true

**来源**: `[FROM_PRD]` — PRD `## Response Schema` 明确定义 `"ok": true // boolean，固定为 true`

**可观测行为**: 响应 JSON 中 `ok` 字段值为布尔 `true`

**验证命令**:
```bash
RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || { echo "FAIL: curl 失败"; exit 1; }
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok 字段不为 true"; exit 1; }
echo "OK: ok == true"
```

**硬阈值**: `.ok == true`（布尔相等，非字符串 "true"）

---

### Step 3: 响应体 ts 字段为有效 ISO 8601 字符串

**来源**: `[FROM_PRD]` — PRD `## Response Schema` 明确定义 `"ts": string // ISO 8601 格式`，§"边界情况"补充 `new Date().toISOString()`

**可观测行为**: `ts` 字段为 string 类型，符合 ISO 8601 格式（含 `T` 和 `Z`）

**验证命令**:
```bash
RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || { echo "FAIL: curl 失败"; exit 1; }
echo "$RESP" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 不是 string"; exit 1; }
TS=$(echo "$RESP" | jq -r '.ts')
[[ "$TS" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] || \
  { echo "FAIL: ts 不符合 ISO 8601，实际=$TS"; exit 1; }
echo "OK: ts 为有效 ISO 8601"
```

**硬阈值**: `.ts | type == "string"` + 正则匹配 `YYYY-MM-DDTHH:mm:ss.mmmZ`

---

### Step 4: 响应体 keys 完整性 — 只含 ok + ts，无额外字段

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 generator 实现时混入 `status`/`alive`/`pong`/`timestamp` 等禁用字段，schema 完整性验证是 PRD 禁用字段清单的可执行形式

**可观测行为**: 响应 JSON 顶层 keys 集合严格等于 `["ok","ts"]`，不多不少

**验证命令**:
```bash
RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || { echo "FAIL: curl 失败"; exit 1; }
echo "$RESP" | jq -e 'keys == ["ok","ts"]' || { echo "FAIL: keys 不等于 [\"ok\",\"ts\"]，实际=$(echo "$RESP" | jq 'keys')"; exit 1; }
echo "OK: keys == [\"ok\",\"ts\"]"
```

**硬阈值**: `keys == ["ok","ts"]`（JSON 键按字母序排）

---

### Step 5: 禁用字段反向检查

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 禁用字段清单（`status`/`alive`/`pong`/`timestamp`）需要 oracle 验证，`! has()` 反向断言确保 generator 不漂移到语义等价词

**可观测行为**: 响应体不含任何禁用字段

**验证命令**:
```bash
RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) || { echo "FAIL: curl 失败"; exit 1; }
echo "$RESP" | jq -e 'has("status") | not' || { echo "FAIL: 禁用字段 status 出现"; exit 1; }
echo "$RESP" | jq -e 'has("alive") | not'  || { echo "FAIL: 禁用字段 alive 出现"; exit 1; }
echo "$RESP" | jq -e 'has("pong") | not'   || { echo "FAIL: 禁用字段 pong 出现"; exit 1; }
echo "$RESP" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp 出现"; exit 1; }
echo "OK: 无禁用字段"
```

**硬阈值**: `has("status") | not` 等 4 项反向断言均通过

---

### Step 6: Error path — 未注册路径返回 404（端点本身必须存在才能验证）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 Brain 通用 404 handler 假绿（v7.12 Bug 10 防模式 1）— 必须验证 `/ping` 真实注册，而非 Brain 的通用 "Not Found" 响应。具体：先用 curl -sf 要求 200，404 = FAIL 即路由未注册

**可观测行为**: `/api/brain/harness/ping` 请求成功（200），不触发通用 404

**验证命令**:
```bash
# 此验证命令本身即端点存在性的防假绿断言：curl -sf 在 4xx/5xx 时 exit 1
RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) \
  || { echo "FAIL: /ping 端点未注册（返回 404/5xx）— 路由未实现"; exit 1; }
echo "OK: /ping 端点已注册（非通用 404）"
```

**硬阈值**: `curl -sf` exit 0（404 = exit 1 = FAIL）

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

# final-e2e: GET /api/brain/harness/ping Golden Path 全程验证
echo "=== final-e2e: /api/brain/harness/ping ==="

# Step 0: Brain 存活探针 — 先确认 Brain API 可达，否则后续 connection refused 无法区分"路由未注册"
curl -sf http://localhost:5221/api/brain/context > /dev/null \
  || { echo "FAIL: Brain API 未启动（localhost:5221 connection refused）— 请先启动 Brain 再跑 E2E"; exit 1; }
echo "OK: Brain API 可达"

# Step 1: 端点可达，返回 200
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/harness/ping)
[ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE (期望 200)"; exit 1; }

# Step 2: ok == true
RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping)
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok 不为 true"; exit 1; }

# Step 3: ts 为 ISO 8601 string
echo "$RESP" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 不是 string"; exit 1; }
TS=$(echo "$RESP" | jq -r '.ts')
[[ "$TS" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]] \
  || { echo "FAIL: ts 不符合 ISO 8601，实际=$TS"; exit 1; }

# Step 4: keys 完整性
echo "$RESP" | jq -e 'keys == ["ok","ts"]' || { echo "FAIL: keys 不等于 [\"ok\",\"ts\"]"; exit 1; }

# Step 5: 禁用字段反向
echo "$RESP" | jq -e 'has("status") | not'    || { echo "FAIL: 禁用字段 status"; exit 1; }
echo "$RESP" | jq -e 'has("alive") | not'     || { echo "FAIL: 禁用字段 alive"; exit 1; }
echo "$RESP" | jq -e 'has("pong") | not'      || { echo "FAIL: 禁用字段 pong"; exit 1; }
echo "$RESP" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp"; exit 1; }

echo "✅ /api/brain/harness/ping Golden Path 验证全部通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| GET /ping 状态码 | `packages/brain/src/routes/__tests__/harness.ping.test.js` | HTTP 200 | → FAIL (路由未注册) |
| ok 字段布尔值 | `packages/brain/src/routes/__tests__/harness.ping.test.js` | `.ok == true` | → FAIL |
| ts 字段类型 | `packages/brain/src/routes/__tests__/harness.ping.test.js` | `.ts | type == "string"` | → FAIL |
| keys 完整性 | `packages/brain/src/routes/__tests__/harness.ping.test.js` | `keys == ["ok","ts"]` | → FAIL |
| 禁用字段反向 | `packages/brain/src/routes/__tests__/harness.ping.test.js` | `! has("status")` 等 | → FAIL |

---

## Risks

| 风险 | 概率 | 影响 | Mitigation |
|---|---|---|---|
| E2E 时 Brain 未启动，`curl` 返回 `connection refused`，与路由未注册的 `404` 失败表现不同但同样 FAIL，难以区分根因 | 中 | 中（诊断成本高，误判为路由问题） | E2E 脚本 Step 0 先探 `/api/brain/context`，`connection refused` 时立即打印"Brain API 未启动"明确错误，区分两类失败 |
| `ts` 字段格式依赖 `new Date().toISOString()` 的运行时行为，Node 版本差异可能导致微小格式差异 | 低 | 低（正则已覆盖标准格式） | 正则 `YYYY-MM-DDTHH:mm:ss.mmmZ` 已约束，Node 14+ 行为一致 |
