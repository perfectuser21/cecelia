# Sprint Contract Draft (Round 1) — W33 Walking Skeleton playground GET /ping

> **W33 验收承诺**：本合同字段名严格字面照搬 PRD `## Response Schema` 段：
> - response success key 字面 = `pong`（**不许漂到** `ping` / `status` / `ok` / `alive` / `healthy` / `response` / `result` / `message` / `pong_value` / `is_alive` / `is_ok` / `data` / `payload` / `body` / `output` / `answer` / `value` / `meta` / `info` / `sum` / `product` / `quotient` / `power` / `remainder` / `factorial` / `negation` / `operation` 任一禁用名）
> - response success value 字面 = JSON 布尔 `true`（**禁用变体** 字符串 `"true"` / 数字 `1` / 字符串 `"ok"` / 字符串 `"alive"` / 字符串 `"yes"` / 字符串 `"pong"` / 对象 `{}` / 对象 `{"alive": true}` / 数组 `[]` / 数组 `[true]` / `null`）
> - schema 完整性：成功响应 keys 字面集合 = `["pong"]`（顶层只有一个 key 名 `pong`）
> - **没有任何 error 分支**——所有 `GET /ping` 一律 200 + 同一固定 body
>
> Proposer 自查 checklist（v7.5/v7.6 死规则）：
> 1. PRD `## Response Schema` 段 success key = `pong` ✓ contract jq -e 用 `.pong` ✓
> 2. PRD `pong` 字面值 = `true`（JSON 布尔字面量）✓ contract jq -e 写 `.pong == true` + `.pong | type == "boolean"` ✓
> 3. PRD 禁用清单字段名 → contract 仅在反向 `has("X") | not` 出现，**不出现在正向断言**
> 4. PRD success schema 完整性 keys 集合 = `["pong"]` ✓ contract jq -e `keys | sort == ["pong"]` + `length == 1` ✓
> 5. `grep -c '^- \[ \] \[BEHAVIOR\]' contract-dod-ws1.md` ≥ 4 ✓（本合同 ws1 含 6 条 BEHAVIOR）
> 6. **trivial spec 反画蛇添足规则**：合同不许出现任何 strict-schema 校验、任何 query param 校验、任何 error 分支断言、任何 HTTP method 守卫——这些都是 W33 PRD 明确禁止的"画蛇添足"

---

## Golden Path

[HTTP 客户端发 `GET /ping`（不带任何 query / body / header）]
→ [playground server 收到请求，不做任何输入校验、不读 query / body / header、不分支]
→ [server 直接返回 HTTP 200，JSON body = `{"pong": true}`（顶层 keys 字面 = `["pong"]`，`.pong` 字面布尔 true）]

---

### Step 1: 客户端发 `GET /ping` 基本请求

**可观测行为**: server 返 HTTP 200，body `{"pong": true}`，顶层 keys 字面集合 = `["pong"]`，`.pong` 类型为 boolean 且字面等于 `true`

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3601 NODE_ENV=production node server.js > /tmp/ws1-step1.log 2>&1 &
SPID=$!
sleep 2

# 1. HTTP 状态码 200
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3601/ping")
[ "$CODE" = "200" ] || { kill $SPID; echo "FAIL: status != 200 (got $CODE)"; exit 1; }

# 2. pong 字面布尔 true
RESP=$(curl -fs "http://localhost:3601/ping")
echo "$RESP" | jq -e '.pong == true' || { kill $SPID; echo "FAIL: .pong != true"; exit 1; }

# 3. pong 类型必须是 boolean（不是 string/number/object/array）
echo "$RESP" | jq -e '.pong | type == "boolean"' || { kill $SPID; echo "FAIL: .pong not boolean"; exit 1; }

# 4. schema 完整性 — 顶层 keys 字面集合相等
echo "$RESP" | jq -e 'keys | sort == ["pong"]' || { kill $SPID; echo "FAIL: keys != [pong]"; exit 1; }

# 5. 顶层只有一个字段
echo "$RESP" | jq -e 'length == 1' || { kill $SPID; echo "FAIL: length != 1"; exit 1; }

# 6. 禁用响应字段名反向不存在
for k in ping status ok alive healthy response result message pong_value is_alive is_ok data payload body output answer value meta info sum product quotient power remainder factorial negation operation; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { kill $SPID; echo "FAIL: 禁用字段 $k 出现在 response"; exit 1; }
done

kill $SPID
echo "✅ Step 1 通过"
```

**硬阈值**: HTTP 200，body `{"pong": true}` 严格相等（pong 字面布尔 true、顶层 keys 集合等于 `["pong"]`、length=1），禁用字段全部反向不存在；耗时 < 5s

---

### Step 2: 客户端发带 query 的 `GET /ping?x=1` 请求

**可观测行为**: server 静默忽略 query，仍返 HTTP 200 + 同一固定 body `{"pong": true}`（**反画蛇添足验证**——generator 不许擅自加 query param 校验或返 400）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3602 NODE_ENV=production node server.js > /tmp/ws1-step2.log 2>&1 &
SPID=$!
sleep 2

# 1. 带未定义 query 仍返 200
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3602/ping?x=1")
[ "$CODE" = "200" ] || { kill $SPID; echo "FAIL: /ping?x=1 status != 200 (got $CODE)"; exit 1; }

# 2. body 与基本请求字面相等
RESP=$(curl -fs "http://localhost:3602/ping?x=1")
echo "$RESP" | jq -e '.pong == true' || { kill $SPID; echo "FAIL: query 影响了响应 pong"; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["pong"]' || { kill $SPID; echo "FAIL: keys != [pong]"; exit 1; }

# 3. 带同名 query pong=false 仍返 200 + {pong: true}（query 不影响响应体）
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3602/ping?pong=false")
[ "$CODE2" = "200" ] || { kill $SPID; echo "FAIL: /ping?pong=false status != 200 (got $CODE2)"; exit 1; }
RESP2=$(curl -fs "http://localhost:3602/ping?pong=false")
echo "$RESP2" | jq -e '.pong == true' || { kill $SPID; echo "FAIL: pong=false query 影响了响应"; exit 1; }

# 4. 带垃圾 query 仍返 200
CODE3=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3602/ping?garbage=xyz&foo=bar")
[ "$CODE3" = "200" ] || { kill $SPID; echo "FAIL: garbage query status != 200 (got $CODE3)"; exit 1; }

kill $SPID
echo "✅ Step 2 通过"
```

**硬阈值**: 任意 query 参（`x=1` / `pong=false` / `garbage=xyz&foo=bar` 等）一律 HTTP 200 + body 字面 `{"pong": true}`；耗时 < 5s

---

### Step 3: 连续多次 `GET /ping` 必须返同一 body（确定性）

**可观测行为**: server 无状态、无 timestamp、无 request_id、无随机化——连续 N 次请求每次返同一字面 body

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3603 NODE_ENV=production node server.js > /tmp/ws1-step3.log 2>&1 &
SPID=$!
sleep 2

# 连续 3 次请求 body 字面相等
R1=$(curl -fs "http://localhost:3603/ping")
R2=$(curl -fs "http://localhost:3603/ping")
R3=$(curl -fs "http://localhost:3603/ping")

[ "$R1" = "$R2" ] || { kill $SPID; echo "FAIL: R1 != R2 (R1=$R1 R2=$R2)"; exit 1; }
[ "$R2" = "$R3" ] || { kill $SPID; echo "FAIL: R2 != R3"; exit 1; }

# 字面值确认
echo "$R1" | jq -e '.pong == true' || { kill $SPID; echo "FAIL: R1 .pong != true"; exit 1; }
echo "$R1" | jq -e 'keys | sort == ["pong"]' || { kill $SPID; echo "FAIL: R1 keys != [pong]"; exit 1; }

kill $SPID
echo "✅ Step 3 通过"
```

**硬阈值**: 3 次连续请求 raw body 字面相等（无 timestamp / uptime / request_id 等时变字段）；耗时 < 5s

---

### Step 4: 既有 8 路由 happy 用例回归

**可观测行为**: `/health` / `/sum` / `/multiply` / `/divide` / `/power` / `/modulo` / `/factorial` / `/increment` 各 1 条 happy 用例仍返预期值（W33 不动这些路由的代码或语义）

**验证命令**:
```bash
cd playground
PLAYGROUND_PORT=3604 NODE_ENV=production node server.js > /tmp/ws1-step4.log 2>&1 &
SPID=$!
sleep 2

curl -fs "http://localhost:3604/health" | jq -e '.ok == true' || { kill $SPID; echo "FAIL: /health"; exit 1; }
curl -fs "http://localhost:3604/sum?a=2&b=3" | jq -e '.sum == 5' || { kill $SPID; echo "FAIL: /sum"; exit 1; }
curl -fs "http://localhost:3604/multiply?a=7&b=5" | jq -e '.product == 35' || { kill $SPID; echo "FAIL: /multiply"; exit 1; }
curl -fs "http://localhost:3604/divide?a=10&b=2" | jq -e '.quotient == 5' || { kill $SPID; echo "FAIL: /divide"; exit 1; }
curl -fs "http://localhost:3604/power?a=2&b=10" | jq -e '.power == 1024' || { kill $SPID; echo "FAIL: /power"; exit 1; }
curl -fs "http://localhost:3604/modulo?a=10&b=3" | jq -e '.remainder == 1' || { kill $SPID; echo "FAIL: /modulo"; exit 1; }
curl -fs "http://localhost:3604/factorial?n=5" | jq -e '.factorial == 120' || { kill $SPID; echo "FAIL: /factorial"; exit 1; }
curl -fs "http://localhost:3604/increment?value=5" | jq -e '.result == 6' || { kill $SPID; echo "FAIL: /increment"; exit 1; }

kill $SPID
echo "✅ Step 4 八路由回归全通过"
```

**硬阈值**: 8 条已有路由 happy 用例全部通过；耗时 < 10s

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd playground

# 启动 server
PLAYGROUND_PORT=3690 NODE_ENV=production node server.js > /tmp/w33-e2e.log 2>&1 &
SPID=$!
sleep 2
trap "kill $SPID 2>/dev/null" EXIT

# ===== Golden Path: GET /ping 严 schema =====

# 1. 状态码 200
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3690/ping")
[ "$CODE" = "200" ] || { echo "❌ /ping status != 200 (got $CODE)"; exit 1; }

# 2. pong 字面布尔 true
RESP=$(curl -fs "http://localhost:3690/ping")
echo "$RESP" | jq -e '.pong == true' || { echo "❌ .pong != true"; exit 1; }

# 3. pong 类型 boolean
echo "$RESP" | jq -e '.pong | type == "boolean"' || { echo "❌ .pong not boolean type"; exit 1; }

# 4. schema 完整性
echo "$RESP" | jq -e 'keys | sort == ["pong"]' || { echo "❌ keys != [pong]"; exit 1; }
echo "$RESP" | jq -e 'length == 1' || { echo "❌ length != 1"; exit 1; }

# 5. 禁用字段反向
for k in ping status ok alive healthy response result message data payload value sum product operation; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { echo "❌ 禁用字段 $k 出现"; exit 1; }
done

# ===== 反画蛇添足: query 被忽略 =====
CODE_Q=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3690/ping?x=1&pong=false")
[ "$CODE_Q" = "200" ] || { echo "❌ /ping?x=1&pong=false status != 200 (got $CODE_Q)"; exit 1; }
RESP_Q=$(curl -fs "http://localhost:3690/ping?x=1&pong=false")
echo "$RESP_Q" | jq -e '.pong == true' || { echo "❌ query 影响了响应"; exit 1; }

# ===== 确定性: 连续请求同 body =====
R1=$(curl -fs "http://localhost:3690/ping")
R2=$(curl -fs "http://localhost:3690/ping")
[ "$R1" = "$R2" ] || { echo "❌ 连续请求 body 不一致"; exit 1; }

# ===== 8 路由回归 =====
curl -fs "http://localhost:3690/health" | jq -e '.ok == true' > /dev/null || { echo "❌ /health 回归"; exit 1; }
curl -fs "http://localhost:3690/sum?a=2&b=3" | jq -e '.sum == 5' > /dev/null || { echo "❌ /sum 回归"; exit 1; }
curl -fs "http://localhost:3690/multiply?a=7&b=5" | jq -e '.product == 35' > /dev/null || { echo "❌ /multiply 回归"; exit 1; }
curl -fs "http://localhost:3690/divide?a=10&b=2" | jq -e '.quotient == 5' > /dev/null || { echo "❌ /divide 回归"; exit 1; }
curl -fs "http://localhost:3690/power?a=2&b=10" | jq -e '.power == 1024' > /dev/null || { echo "❌ /power 回归"; exit 1; }
curl -fs "http://localhost:3690/modulo?a=10&b=3" | jq -e '.remainder == 1' > /dev/null || { echo "❌ /modulo 回归"; exit 1; }
curl -fs "http://localhost:3690/factorial?n=5" | jq -e '.factorial == 120' > /dev/null || { echo "❌ /factorial 回归"; exit 1; }
curl -fs "http://localhost:3690/increment?value=5" | jq -e '.result == 6' > /dev/null || { echo "❌ /increment 回归"; exit 1; }

echo "✅ W33 Walking Skeleton GET /ping Golden Path 全部验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /ping 路由 + 单测 + README

**范围**: 在 `playground/server.js` 在 `/increment` 之后、`app.listen` 之前新增 `GET /ping` 路由（最简单的 express handler `(req, res) => res.json({ pong: true })`，**不读 query**、**不加任何校验**、**不加 try/catch**、**不加 error 分支**）；在 `playground/tests/server.test.js` 新增 `describe('GET /ping', ...)` 块（happy 3+ + schema 完整性 oracle 1+ + 反画蛇添足 2+ + 确定性 1+ + 8 路由回归 8+）；在 `playground/README.md` 端点列表加 `/ping` 段（至少 1 个 happy 示例）

**大小**: S（< 100 行总变更）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/ping.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/ping.test.js` | GET /ping 严 schema (`{pong: true}`, keys=[pong], pong is boolean, length=1) + query 静默忽略 + 确定性 + 禁用字段反向 + 8 路由回归 | WS1 → N failures (`/ping` 路由不存在前所有 ping 用例 FAIL) |
