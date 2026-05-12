# Sprint Contract Draft (Round 2) — W33 Walking Skeleton playground GET /ping

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
> 5. `grep -c '^- \[ \] \[BEHAVIOR\]' contract-dod-ws1.md` ≥ 4 ✓（本合同 ws1 含 **7 条 BEHAVIOR**：B1 状态码+pong==true，B2 pong type==boolean，B3 keys+length 严 schema，B4 禁用字段反向，B5 query 静默忽略，B6 连续请求确定性，B7 八路由回归）
> 6. **trivial spec 反画蛇添足规则**：合同不许出现任何 strict-schema 校验、任何 query param 校验、任何 error 分支断言、任何 HTTP method 守卫——这些都是 W33 PRD 明确禁止的"画蛇添足"
> 7. **DoD 文件是 oracle 断言的唯一文本源（SSOT）**：本合同 Step N 的"验证命令"段落只**引用** DoD ws1 BEHAVIOR 编号（B1-B7），不重复粘贴 jq -e 字面文本——保证未来改 oracle 只改 DoD 一处即可，避免两份文本漂移

---

## Round 2 反馈处置

上轮 Reviewer 1 个 issue + 低分维度回应：

1. **新增 [ARTIFACT] 校验 `export default app`**（解决上轮 blocking issue）：tests/ws1/ping.test.js `import app from '../../../../playground/server.js'` 依赖 server.js 末尾的 `export default app` 一行；若 generator 误删该行则测试全 fail 但 ARTIFACT 校验不抓——本轮在 contract-dod-ws1.md 新增独立 ARTIFACT 抓 `export default app`
2. **修正自指数量**（非阻塞观察）：上轮 checklist 写"ws1 含 6 条 BEHAVIOR"实际 7 条，本轮改回正确值 7
3. **降低粘贴风险**（非阻塞观察 SSOT）：Step 1/2/3 验证命令不再原样粘贴 jq -e 文本，而是改成"引用 DoD ws1 B1-B7 编号"——DoD 文件为唯一文本源
4. **新增 `## Risks` 段**（应对 risk_registered=3 低分）：枚举本任务可识别的 3 类风险 + 应对

---

## Golden Path

[HTTP 客户端发 `GET /ping`（不带任何 query / body / header）]
→ [playground server 收到请求，不做任何输入校验、不读 query / body / header、不分支]
→ [server 直接返回 HTTP 200，JSON body = `{"pong": true}`（顶层 keys 字面 = `["pong"]`，`.pong` 字面布尔 true）]

---

### Step 1: 客户端发 `GET /ping` 基本请求

**可观测行为**: server 返 HTTP 200，body `{"pong": true}`，顶层 keys 字面集合 = `["pong"]`，`.pong` 类型为 boolean 且字面等于 `true`

**验证命令**: 详见 `contract-dod-ws1.md` BEHAVIOR 段 **B1（状态码 200 + .pong == true）**、**B2（.pong type == boolean）**、**B3（keys 字面集合 ["pong"] + length == 1）**、**B4（禁用字段反向不存在）**。Evaluator 直接执行 DoD 文件 `Test: manual:bash` 命令；本 Step 不重复粘贴 jq -e 文本（SSOT 规则 — 改 oracle 只改 DoD 一处）。

**硬阈值**: B1 ∧ B2 ∧ B3 ∧ B4 全部 exit 0（manual:bash 命令 echo OK）；耗时 < 5s

---

### Step 2: 客户端发带 query 的 `GET /ping?x=1` 请求

**可观测行为**: server 静默忽略 query，仍返 HTTP 200 + 同一固定 body `{"pong": true}`（**反画蛇添足验证**——generator 不许擅自加 query param 校验或返 400）

**验证命令**: 详见 `contract-dod-ws1.md` BEHAVIOR 段 **B5（GET /ping?x=1 与 GET /ping?pong=false 仍返 200 + 同 body）**。Evaluator 直接执行 DoD B5 manual:bash；本 Step 不重复粘贴。

**硬阈值**: B5 exit 0；任意 query 参（`x=1` / `pong=false` / `garbage=xyz` 等）一律 HTTP 200 + body 字面 `{"pong": true}`；耗时 < 5s

---

### Step 3: 连续多次 `GET /ping` 必须返同一 body（确定性）

**可观测行为**: server 无状态、无 timestamp、无 request_id、无随机化——连续 N 次请求每次返同一字面 body

**验证命令**: 详见 `contract-dod-ws1.md` BEHAVIOR 段 **B6（连续 3 次 GET /ping 返同一 raw body）**。Evaluator 直接执行 DoD B6 manual:bash；本 Step 不重复粘贴。

**硬阈值**: B6 exit 0；3 次连续请求 raw body 字面相等（无 timestamp / uptime / request_id 等时变字段）；耗时 < 5s

---

### Step 4: 既有 8 路由 happy 用例回归

**可观测行为**: `/health` / `/sum` / `/multiply` / `/divide` / `/power` / `/modulo` / `/factorial` / `/increment` 各 1 条 happy 用例仍返预期值（W33 不动这些路由的代码或语义）

**验证命令**: 详见 `contract-dod-ws1.md` BEHAVIOR 段 **B7（八路由 happy 用例回归）**。Evaluator 直接执行 DoD B7 manual:bash；本 Step 不重复粘贴。

**硬阈值**: B7 exit 0；8 条已有路由 happy 用例全部通过；耗时 < 10s

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**（汇总 4 步 Golden Path，对应 DoD ws1 B1-B7；evaluator 既可独立跑 7 条 DoD BEHAVIOR，也可跑下面汇总脚本）:

```bash
#!/bin/bash
set -e

cd playground

# 启动 server
PLAYGROUND_PORT=3690 NODE_ENV=production node server.js > /tmp/w33-e2e.log 2>&1 &
SPID=$!
sleep 2
trap "kill $SPID 2>/dev/null" EXIT

# ===== Step 1: Golden Path GET /ping 严 schema (= DoD B1+B2+B3+B4) =====

# 1.1 状态码 200 (= DoD B1)
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3690/ping")
[ "$CODE" = "200" ] || { echo "❌ /ping status != 200 (got $CODE)"; exit 1; }

# 1.2 pong 字面布尔 true (= DoD B1)
RESP=$(curl -fs "http://localhost:3690/ping")
echo "$RESP" | jq -e '.pong == true' > /dev/null || { echo "❌ .pong != true"; exit 1; }

# 1.3 pong 类型 boolean (= DoD B2)
echo "$RESP" | jq -e '.pong | type == "boolean"' > /dev/null || { echo "❌ .pong not boolean type"; exit 1; }

# 1.4 schema 完整性 keys + length (= DoD B3)
echo "$RESP" | jq -e 'keys | sort == ["pong"]' > /dev/null || { echo "❌ keys != [pong]"; exit 1; }
echo "$RESP" | jq -e 'length == 1' > /dev/null || { echo "❌ length != 1"; exit 1; }

# 1.5 禁用字段反向 (= DoD B4)
for k in ping status ok alive healthy response result message pong_value is_alive is_ok data payload body output answer value meta info sum product quotient power remainder factorial negation operation; do
  echo "$RESP" | jq -e "has(\"$k\") | not" > /dev/null || { echo "❌ 禁用字段 $k 出现"; exit 1; }
done

# ===== Step 2: 反画蛇添足 query 静默忽略 (= DoD B5) =====
CODE_Q=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3690/ping?x=1&pong=false")
[ "$CODE_Q" = "200" ] || { echo "❌ /ping?x=1&pong=false status != 200 (got $CODE_Q)"; exit 1; }
RESP_Q=$(curl -fs "http://localhost:3690/ping?x=1&pong=false")
echo "$RESP_Q" | jq -e '.pong == true' > /dev/null || { echo "❌ query 影响了响应"; exit 1; }

# ===== Step 3: 确定性连续请求 (= DoD B6) =====
R1=$(curl -fs "http://localhost:3690/ping")
R2=$(curl -fs "http://localhost:3690/ping")
R3=$(curl -fs "http://localhost:3690/ping")
[ "$R1" = "$R2" ] || { echo "❌ 连续请求 body 不一致 (R1=$R1 R2=$R2)"; exit 1; }
[ "$R2" = "$R3" ] || { echo "❌ 连续请求 body 不一致 (R2=$R2 R3=$R3)"; exit 1; }

# ===== Step 4: 8 路由回归 (= DoD B7) =====
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

**通过标准**: 脚本 exit 0；等价于 DoD ws1 B1-B7 全部 exit 0

---

## Risks（v7 新增；应对 R1 risk_registered 低分）

| ID | 风险描述 | 触发场景 | 应对（合同/DoD 已覆盖） |
|---|---|---|---|
| R1 | **画蛇添足风险**：generator 受 W19~W26 富 oracle 习惯影响，擅自给 /ping 加 strict-schema query 校验、error 分支或 HTTP method 守卫，违背 W33 trivial 语义 | generator round 1+ 实现 | DoD ARTIFACT 第 4 条 `req.query` / `status(4xx)` 静态扫描；BEHAVIOR B5 query 静默忽略验；BEHAVIOR B7 八路由回归（generator 不许动其他路由） |
| R2 | **export default app 被改坏**：generator 编辑 server.js 时误改/删 `export default app` 一行，导致 tests/ws1/ping.test.js 的 `import app from ...` 失败、vitest 全 fail、但 evaluator manual:bash 因独立起服务可能仍过 | generator 编辑 server.js | DoD ARTIFACT 新增 `export default app` 字面字符串校验；保证 import 链不断 |
| R3 | **字段名漂移**：generator 用 `ping`/`status: "ok"`/`result: true`/字符串 `"true"` 等 PRD 禁用清单变体替代 `pong: true` 字面值 | generator 实现路由 | DoD ARTIFACT 第 2/3 条静态扫描禁用名 + 强制字面 `pong: true`；BEHAVIOR B1+B2+B4 三层 oracle（值/类型/反向）联防 |

---

## Workstreams

workstream_count: 1

### Workstream 1: playground GET /ping 路由 + 单测 + README

**范围**: 在 `playground/server.js` 在 `/increment` 之后、`app.listen` 之前新增 `GET /ping` 路由（最简单的 express handler `(req, res) => res.json({ pong: true })`，**不读 query**、**不加任何校验**、**不加 try/catch**、**不加 error 分支**）；保持 `export default app` 末尾一行不变；在 `playground/tests/server.test.js` 新增 `describe('GET /ping', ...)` 块（happy 3+ + schema 完整性 oracle 1+ + 反画蛇添足 2+ + 确定性 1+ + 8 路由回归 8+）；在 `playground/README.md` 端点列表加 `/ping` 段（至少 1 个 happy 示例）

**大小**: S（< 100 行总变更）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/ping.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/ping.test.js` | DoD B1-B7 全部映射：GET /ping 严 schema (`{pong: true}`, keys=[pong], pong is boolean, length=1) + query 静默忽略 + 确定性 + 禁用字段反向 + 8 路由回归 | WS1 → N failures (`/ping` 路由不存在前所有 ping 用例 FAIL) |
