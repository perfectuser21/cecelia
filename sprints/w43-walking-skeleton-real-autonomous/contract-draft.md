# Sprint Contract Draft (Round 3)

## Golden Path
[客户端] → [GET /api/brain/ping] → [Brain status.js 路由处理（无 DB 操作）] → [HTTP 200 + {pong:true, ts:\<unix_seconds\>}]

### Step 1: 客户端发 GET /api/brain/ping

**可观测行为**: HTTP 200，body 恰好含 `pong: true`（boolean）和 `ts: <Unix seconds>`（number integer），不访问数据库

**验证命令**:
```bash
# 等待 Brain 就绪（最多 10s）
for i in $(seq 1 10); do
  curl -fs localhost:5221/api/brain/ping 2>/dev/null && break || sleep 1
done || exit 1

RESP=$(curl -fs localhost:5221/api/brain/ping)
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: pong != true"; exit 1; }
echo "$RESP" | jq -e '(.ts | type) == "number"' || { echo "FAIL: ts 非 number 类型"; exit 1; }
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
echo "$ERR_BODY" | jq -e '.error == "Method Not Allowed"' || { echo "FAIL: error 字段不等于 'Method Not Allowed'"; exit 1; }
```

**硬阈值**: HTTP 405，body `error` 字段字面值等于 `"Method Not Allowed"`

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 等待 Brain 就绪（最多 10s）
for i in $(seq 1 10); do
  curl -fs localhost:5221/api/brain/ping 2>/dev/null && break || sleep 1
done || { echo "FAIL: Brain 未就绪"; exit 1; }

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
echo "$RESP" | jq -e 'has("alive") | not' || { echo "FAIL: 禁用字段 alive 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("status") | not' || { echo "FAIL: 禁用字段 status 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("timestamp") | not' || { echo "FAIL: 禁用字段 timestamp 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用字段 data 漏网"; exit 1; }

# 5. POST → 405 + 精确 error 字符串
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/ping)
[ "$CODE" = "405" ] || { echo "FAIL: POST 未返 405，got $CODE"; exit 1; }
ERR=$(curl -s -X POST localhost:5221/api/brain/ping)
echo "$ERR" | jq -e '.error == "Method Not Allowed"' || { echo "FAIL: error 字段不等于 'Method Not Allowed'"; exit 1; }

# 6. /ping 与 /ping-extended 路由相互独立（/ping-extended 不被影响）
EXT_CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/ping-extended)
[ "$EXT_CODE" = "200" ] || { echo "FAIL: /ping-extended 返回异常 HTTP $EXT_CODE，期望 200"; exit 1; }

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: 添加 /ping 路由 + 生产单元测试

**范围**:
- `packages/brain/src/routes/status.js`：追加 `GET /ping`（返 `{pong:true,ts:<unix>}`）和 `ALL /ping`（405，error: "Method Not Allowed"）两条路由
- `packages/brain/src/__tests__/ping.test.js`：Generator **新建**生产单元测试套件（覆盖 pong/ts/keys/禁用字段/405）

**大小**: S（路由 ~25 行 + 测试 ~80 行，合计 ~105 行；2 文件 ≤ 3 文件阈值）
**依赖**: 无

**两类测试文件说明**（v7.4 DoD 分家规则）：

| 文件 | 路径 | 阶段 | 职责 |
|---|---|---|---|
| **DoD red-bar 文件** | `sprints/w43-walking-skeleton-real-autonomous/tests/ws1/ping.test.js` | Red（实现**前**） | **Evaluator 运行此文件确认红**：/ping 路由未添加时全返 404，5 个 it() FAIL |
| **生产单元测试** | `packages/brain/src/__tests__/ping.test.js` | Green（实现**后**） | **Generator 产出物**：实现路由后由 Generator 新建，vitest 全 PASS |

两类文件不能混用引用：合同 ARTIFACT DoD 只验生产测试文件存在性；DoD BEHAVIOR 的 `manual:bash` 命令对 Brain 运行时 curl，**不跑 vitest**。

---

## Test Contract

| Workstream | DoD red-bar 文件（Evaluator 确认 Red） | 生产测试文件（Generator 产出物） | BEHAVIOR 覆盖 | 红证据 |
|---|---|---|---|---|
| WS1 | `sprints/w43-walking-skeleton-real-autonomous/tests/ws1/ping.test.js` | `packages/brain/src/__tests__/ping.test.js` | pong值/ts类型/ts范围/keys完整性/禁用字段/405 error | 5 failures（/ping 路由未添加时返 404）|

**阶段职责**：
- **Red 阶段**：Evaluator 运行 `sprints/.../tests/ws1/ping.test.js`，确认 ≥5 failures
- **Green 阶段**：Generator 新建 `packages/brain/src/__tests__/ping.test.js`，实现路由后 vitest 全 PASS

---

## Risk Register

| 风险 | 可能性 | 影响 | 缓解措施 |
|---|---|---|---|
| Brain 运行时 port 5221 被占用 | 低 | 高 | E2E 脚本加 10s 等待循环，Brain 启动失败 → exit 1 报错 |
| `router.all('/ping')` 被 `router.all('*')` 已有处理器拦截（如 catch-all 405）| 中 | 中 | 明确在 `router.get('/ping')` 之后紧接 `router.all('/ping')`；ARTIFACT 检查两条路由都存在 |
| `/ping-extended` 路由前缀匹配误拦截 `/ping` | 低 | 中 | E2E Step 6 验证 `/ping-extended` 仍返 200；route 顺序：先 `/ping` 再 `/ping-extended` |
| ts 精度漂移（毫秒 vs 秒） | 低 | 高 | BEHAVIOR Step 2 明确范围检查 `1e9 < ts < 1e10`；禁用字段清单含 `timestamp` |
