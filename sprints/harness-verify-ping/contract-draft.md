# Sprint Contract Draft (Round 3)

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

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 1："调用方发送 `GET /api/brain/harness/ping`（无鉴权要求）"

**可观测行为**: Brain 返回 HTTP 200，无需认证头

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/harness/ping)
[ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE"; exit 1; }
echo "OK: HTTP 200"
```

**硬阈值**: HTTP 200
> Note: 响应时间 < 2s 为建议参考值，不作为 evaluator 硬判标准（无计时断言）

---

### Step 2: Brain harness 路由返回 ok=true + ts 字段

**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 3："返回 HTTP 200，body 为 `{"ok": true, "ts": "<ISO 8601 时间戳>"}`"

**可观测行为**: 响应体包含 `ok: true` 和 `ts: <string>`，keys 严格为 `["ok","ts"]`

**验证命令**:
```bash
RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping)
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok 字段不为 true"; exit 1; }
echo "$RESP" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 字段不是 string"; exit 1; }
echo "$RESP" | jq -e 'keys == ["ok","ts"]' || { echo "FAIL: keys 不严格等于 [ok,ts]"; exit 1; }
echo "OK: response schema 验证通过"
```

**硬阈值**: `ok=true`，`ts` 为 string，keys 严格 `["ok","ts"]`

---

### Step 3: ts 为合法 ISO 8601 时间戳（format 校验）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 明确要求 ts 格式为 ISO 8601，但仅靠 `type == "string"` 无法防止 generator 返回非法格式字符串（如 "now" / Unix 毫秒数）；此步确保严格格式

**可观测行为**: ts 值经 `new Date(ts).toISOString()` 还原后与原值相等

**验证命令**:
```bash
TS=$(curl -sf http://localhost:5221/api/brain/harness/ping | jq -r '.ts')
node -e "const ts='$TS'; if(new Date(ts).toISOString()!==ts){process.exit(1)}" \
  || { echo "FAIL: ts 不是合法 ISO 8601"; exit 1; }
echo "OK: ts ISO 8601 格式验证通过"
```

**硬阈值**: `new Date(ts).toISOString() === ts`

---

## Risks

| 风险 | Mitigation |
|---|---|
| Brain server 未运行 → curl -sf 触发 ECONNREFUSED → evaluator 报 FAIL | E2E 第 1 步 curl 失败即 exit 1 并输出明确错误信息（见下方 E2E 脚本第 1 步） |

---

## E2E 验收（target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

# 1. 验证端点可达（curl -sf：HTTP 5xx/4xx 均触发 exit 1）
RESP=$(curl -sf http://localhost:5221/api/brain/harness/ping) \
  || { echo "FAIL: /ping 不可达（Brain 未启动或路由未注册）"; exit 1; }

# 2. ok 字段
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok 不为 true"; exit 1; }

# 3. ts 字段类型
echo "$RESP" | jq -e '.ts | type == "string"' || { echo "FAIL: ts 不是 string"; exit 1; }

# 4. ts 格式严格 ISO 8601
TS=$(echo "$RESP" | jq -r '.ts')
node -e "const ts='$TS'; if(new Date(ts).toISOString()!==ts){process.exit(1)}" \
  || { echo "FAIL: ts 非法 ISO 8601"; exit 1; }

# 5. keys 完整性（兼覆盖禁用字段不存在）
echo "$RESP" | jq -e 'keys == ["ok","ts"]' || { echo "FAIL: keys 不严格"; exit 1; }

echo "✅ Golden Path 验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GET /ping 路由 | `packages/brain/src/routes/__tests__/harness.ping.test.js` | HTTP 200 / ok=true / ts ISO 8601 / keys 完整性 / 禁用字段 ×4 | → 6 failures（实现前）|
