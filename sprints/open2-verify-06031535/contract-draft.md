# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面 + api_registry 推导 — /ping 端点风格对齐）

### Endpoint: GET /api/brain/harness/healthz

**Success (HTTP 200)**:
```json
{"ok": true, "service": "harness", "ts": "<ISO 8601 string>"}
```
- `ok` (boolean, 必填): 来源——PRD Response Schema 表定义，固定值 `true`
- `service` (string, 必填): 来源——PRD Response Schema 表定义，固定字面量 `"harness"`
- `ts` (string, 必填): 来源——PRD Response Schema 表定义，`new Date().toISOString()` 格式，如 `"2026-06-03T10:00:00.000Z"`

**禁用字段名**: `status`, `healthy`, `alive`, `name`, `timestamp`, `time`（语义等价词，PRD 未授权，禁止出现在响应体）

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

## Golden Path

[客户端 GET] → [Brain harness 路由] → [返回 200 JSON {ok,service,ts}]

---

### Step 1: 客户端发送 GET /api/brain/harness/healthz（无鉴权）

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 1："调用方发起 `GET /api/brain/harness/healthz`"

**可观测行为**: Brain 返回 HTTP 200，无需认证头

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/harness/healthz)
[ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE"; exit 1; }
echo "OK: HTTP 200"
```

**硬阈值**: HTTP 200，响应时间 < 2s

---

### Step 2: 响应体包含 ok=true、service="harness"、ts 字段，keys 完整

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 2 + 3："服务返回 HTTP 200，响应体 `{ ok: true, service: 'harness', ts: <ISO8601> }`"

**可观测行为**: 响应体三个字段均正确，keys 严格为 `["ok","service","ts"]`（字母排序）

**验证命令**:
```bash
RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz)
echo "$RESP" | jq -e '.ok == true'           || { echo "FAIL: ok 不为 true"; exit 1; }
echo "$RESP" | jq -e '.service == "harness"' || { echo "FAIL: service 不为 harness"; exit 1; }
echo "$RESP" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 不是 string"; exit 1; }
echo "$RESP" | jq -e 'keys == ["ok","service","ts"]' || { echo "FAIL: keys 不严格等于 [ok,service,ts]"; exit 1; }
echo "OK: response schema 验证通过"
```

**硬阈值**: ok=true，service="harness"，ts 为 string，keys 严格 `["ok","service","ts"]`

---

### Step 3: ts 为合法 ISO 8601 时间戳（格式校验）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 明确要求 `new Date(ts)` 有效，仅靠 `type == "string"` 无法防止 generator 返回非法格式字符串（如 Unix 毫秒数字符串）；此步严格校验有效性

**可观测行为**: ts 值经 `new Date(ts)` 解析不为 NaN

**验证命令**:
```bash
TS=$(curl -sf http://localhost:5221/api/brain/harness/healthz | jq -r '.ts')
node -e "const d=new Date('$TS'); if(isNaN(d.getTime())) process.exit(1)" \
  || { echo "FAIL: ts 不是有效 ISO8601"; exit 1; }
echo "OK: ts 格式验证通过"
```

**硬阈值**: `new Date(ts).getTime()` 不为 NaN

---

### Step 4: 禁用字段一律不存在（防字段漂移）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 generator 输出语义等价词字段（status/healthy/name/timestamp），schema 必须严格等于 PRD 定义；`keys == [...]` 已覆盖整体，此步单独验证各禁用名作为明确合同项

**可观测行为**: 响应体中 `status`、`healthy`、`name`、`timestamp` 字段均不存在

**验证命令**:
```bash
RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz)
echo "$RESP" | jq -e 'has("status") | not'    || { echo "FAIL: 禁用字段 status"; exit 1; }
echo "$RESP" | jq -e 'has("healthy") | not'   || { echo "FAIL: 禁用字段 healthy"; exit 1; }
echo "$RESP" | jq -e 'has("name") | not'      || { echo "FAIL: 禁用字段 name"; exit 1; }
echo "$RESP" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp"; exit 1; }
echo "OK: 禁用字段全部不存在"
```

**硬阈值**: 四个禁用字段均不在响应体中

---

## E2E 验收（target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

# 1. 验证端点可达（curl -sf：HTTP 5xx/4xx 均触发 exit 1）
RESP=$(curl -sf http://localhost:5221/api/brain/harness/healthz) \
  || { echo "FAIL: /healthz 不可达（Brain 未启动或路由未注册）"; exit 1; }

# 2. ok 字段
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok 不为 true"; exit 1; }

# 3. service 字段字面量
echo "$RESP" | jq -e '.service == "harness"' || { echo "FAIL: service 不为 harness"; exit 1; }

# 4. ts 字段类型
echo "$RESP" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 不是 string"; exit 1; }

# 5. ts 格式有效
TS=$(echo "$RESP" | jq -r '.ts')
node -e "const d=new Date('$TS'); if(isNaN(d.getTime())) process.exit(1)" \
  || { echo "FAIL: ts 非法 ISO8601"; exit 1; }

# 6. keys 完整性
echo "$RESP" | jq -e 'keys == ["ok","service","ts"]' || { echo "FAIL: keys 不严格"; exit 1; }

# 7. 禁用字段不存在
echo "$RESP" | jq -e 'has("status") | not'    || { echo "FAIL: 禁用字段 status"; exit 1; }
echo "$RESP" | jq -e 'has("healthy") | not'   || { echo "FAIL: 禁用字段 healthy"; exit 1; }
echo "$RESP" | jq -e 'has("name") | not'      || { echo "FAIL: 禁用字段 name"; exit 1; }
echo "$RESP" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp"; exit 1; }

echo "✅ Golden Path 验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GET /healthz 路由 | `tests/harness-healthz.test.js` | HTTP 200 / ok=true / service=harness / ts ISO8601 / keys 完整性 / 禁用字段 ×4 / error path | → 6 failures（实现前）|
