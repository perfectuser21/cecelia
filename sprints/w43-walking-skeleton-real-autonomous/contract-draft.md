# Sprint Contract Draft (Round 1)

## Golden Path
[客户端] → [GET /api/brain/ping] → [Brain status.js 路由处理（无 DB 操作）] → [HTTP 200 + {pong:true, ts:\<unix_seconds\>}]

### Step 1: 客户端发 GET /api/brain/ping

**可观测行为**: HTTP 200，body 恰好含 `pong: true`（boolean）和 `ts: <Unix seconds>`（number integer），不访问数据库

**验证命令**:
```bash
RESP=$(curl -fs localhost:5221/api/brain/ping)
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: pong != true"; exit 1; }
echo "$RESP" | jq -e '.ts | type == "number"' || { echo "FAIL: ts 非 number 类型"; exit 1; }
echo "$RESP" | jq -e '.ts > 1000000000 and .ts < 10000000000' || { echo "FAIL: ts 不在 Unix seconds 范围（疑似毫秒）"; exit 1; }
echo "$RESP" | jq -e 'keys == ["pong","ts"]' || { echo "FAIL: keys 不符合 schema 完整性"; exit 1; }
```

**硬阈值**: HTTP 200，响应时间 < 200ms，body keys 恰好 `["pong","ts"]`

---

### Step 2: POST /api/brain/ping → 405 拒绝

**可观测行为**: 非 GET 方法（POST/PUT/DELETE）返 HTTP 405 + `{error: "Method Not Allowed"}`

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/ping)
[ "$CODE" = "405" ] || { echo "FAIL: POST 未返 405，got $CODE"; exit 1; }
ERR_BODY=$(curl -s -X POST localhost:5221/api/brain/ping)
echo "$ERR_BODY" | jq -e '.error | type == "string"' || { echo "FAIL: error 字段非 string"; exit 1; }
```

**硬阈值**: HTTP 405，body 含 `error` 字符串字段

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 1. GET /ping — pong 字段值
RESP=$(curl -fs localhost:5221/api/brain/ping)
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: pong != true"; exit 1; }

# 2. ts 类型 + Unix seconds 范围（非毫秒非字符串）
echo "$RESP" | jq -e '(.ts | type) == "number"' || { echo "FAIL: ts 非 number 类型"; exit 1; }
echo "$RESP" | jq -e '.ts > 1000000000 and .ts < 10000000000' || { echo "FAIL: ts 不在 Unix seconds 范围"; exit 1; }

# 3. schema 完整性 — keys 恰好 ["pong","ts"]
echo "$RESP" | jq -e 'keys == ["pong","ts"]' || { echo "FAIL: keys 不符合 schema，期望恰好 [pong,ts]"; exit 1; }

# 4. 禁用字段反向检查（generator 不许漂移）
echo "$RESP" | jq -e 'has("ok") | not' || { echo "FAIL: 禁用字段 ok 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用字段 data 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("alive") | not' || { echo "FAIL: 禁用字段 alive 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("status") | not' || { echo "FAIL: 禁用字段 status 漏网"; exit 1; }

# 5. 非 GET 方法 → 405
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/ping)
[ "$CODE" = "405" ] || { echo "FAIL: POST 未返 405，got $CODE"; exit 1; }

# 6. /ping 与 /ping-extended 相互独立（/ping 不被 extended 路由吞）
EXT=$(curl -fs localhost:5221/api/brain/ping-extended 2>/dev/null | jq -r '.status // "missing"')
[ "$EXT" = "ok" ] || { echo "FAIL: /ping-extended 被影响，返回异常"; exit 1; }

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: 添加 /ping 路由 + 单元测试

**范围**: `packages/brain/src/routes/status.js` 追加 `GET /ping`（返 `{pong,ts}`）和 `ALL /ping`（405）两条路由；`packages/brain/src/__tests__/ping.test.js` 新增单元测试套件
**大小**: S（预估路由 ~25 行 + 测试 ~80 行，合计 ~105 行 < 200 行阈值；涉及 2 个文件 ≤ 3 文件阈值）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/w43-walking-skeleton-real-autonomous/tests/ws1/ping.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/w43-walking-skeleton-real-autonomous/tests/ws1/ping.test.js` | pong值/ts类型/ts范围/keys完整/禁用字段/405 | 4+ failures（/ping 路由不存在时 404） |
