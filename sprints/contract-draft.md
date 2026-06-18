# Sprint Contract Draft (Round 1) — playground GET /ping（smoke fire）

## 已知约束（来自回归测试）

- [playground/tests/server.test.js] → `GET /health → 200 {ok: true}`（存活探测既有惯例：布尔字段 + 单字段响应）
- [playground/tests/server.test.js] → `GET /sum` / `GET /multiply` 等：每路由响应字段单一、`Object.prototype.hasOwnProperty` 反向断言禁用字段、error path 显式 400
- 约束推论：新增 `/ping` 必须沿用「单字段布尔响应 + keys 完整性 + 禁用字段反向」既有测试风格，禁止引入 `operation` 等无关字段（`/ping` 零计算，不需要 operation 标识）

## Response Schema（推导来源: PRD字面 + REST惯例；api_registry/db_registry/test_registry 在 Brain 不可达时为空，回退 PRD 字面）

### Endpoint: GET /ping
**Success (HTTP 200)**:
```json
{"pong": true}
```
- `pong` (boolean, 必填): 来源——PRD「Golden Path」第 3 步字面定义 `{"pong":true}`；值恒为布尔 `true`（存活探测，零参数零计算）
**禁用字段名**: `ok`（/health 同义替换，禁混用）、`ping`、`status`、`alive`、`message`、`data`（REST 存活探测常见同义词，contract 正向断言里绝对不出现）
**Schema 完整性**: 顶层 keys 必须**完全等于** `["pong"]`（不多不少）
**Error (HTTP 4xx)**: N/A — `/ping` 无 query 校验，任意 query 参数均忽略并返回 200；非 GET 方法（如 POST /ping）由 express 默认 404 处理，不在本 sprint 实现范围（仅作负向行为验证，非业务 error path）

---

## Golden Path

[客户端发起 `GET /ping`] → [playground server 命中 `/ping` 路由] → [返回 HTTP 200 `{"pong":true}`]

### Step 1: 客户端发送 `GET /ping`（无 query 参数）
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」具体第 1 条「客户端发送 `GET /ping`（无 query 参数）」

**可观测行为**: HTTP 客户端对 playground server 发起 `GET /ping` 请求，连接成功、收到 HTTP 响应。

**验证命令**:
```bash
# 启动 playground（target_environment=playground 训练 sprint，按 skill playground 例外允许 node playground/server.js）
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2
curl -sf "localhost:3001/ping" -o /dev/null && echo "OK: /ping 可达" || { echo "FAIL: /ping 不可达"; kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: HTTP 请求成功建立连接，curl `-f` 在非 2xx 时返回非 0 exit。
**验证命令（硬阈值 codify）**: `curl -sf "localhost:3001/ping" -o /dev/null`（`-f` 使 4xx/5xx → 非 0 exit）

---

### Step 2: playground server 命中 `/ping` 路由
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条「playground server 命中 `/ping` 路由」

**可观测行为**: 请求被 `/ping` 路由处理（而非落入 express 默认 404），响应状态码为 200。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3001/ping")
[ "$CODE" = "200" ] || { echo "FAIL: 期望 200，实得 $CODE（路由未注册时为 404）"; kill $SPID; exit 1; }
kill $SPID
echo "OK: /ping 命中路由 200"
```

**硬阈值**: HTTP 状态码 = 200（路由未注册 → express 默认 404 → FAIL，杜绝假绿）。
**验证命令（硬阈值 codify）**: `CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:3001/ping); [ "$CODE" = "200" ]`

---

### Step 3: 返回 HTTP 200 `{"pong":true}`
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条「返回 HTTP 200：`{"pong":true}`」

**可观测行为**: 响应 body 为 JSON `{"pong":true}`，`pong` 为布尔 `true`，且无任何其他字段。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2
RESP=$(curl -sf "localhost:3001/ping")
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: pong != true（实得 $RESP）"; kill $SPID; exit 1; }
echo "$RESP" | jq -e '.pong | type == "boolean"' || { echo "FAIL: pong 非布尔"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["pong"]' || { echo "FAIL: schema 不止 pong 字段（实得 $RESP）"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'has("ok") | not' || { echo "FAIL: 禁用字段 ok 漏网"; kill $SPID; exit 1; }
kill $SPID
echo "OK: /ping 返回 {\"pong\":true} schema 完整"
```

**硬阈值**: `pong == true`（布尔）+ 顶层 keys 完全等于 `["pong"]` + 禁用字段 `ok` 不存在。
**验证命令（硬阈值 codify）**: 上方 `jq -e '.pong == true'` + `jq -e 'keys == ["pong"]'` + `jq -e 'has("ok") | not'` 三连。

---

### Step 4（边界）: 带任意 query 参数仍返回 200 `{"pong":true}`
**来源**: `[FROM_PRD]` — PRD「边界情况」第 1 条「带任意 query 参数（如 `/ping?x=1`）→ 仍正常返回 200 `{"pong":true}`（参数忽略，不报错）」

**可观测行为**: `GET /ping?x=1` 与无参数行为完全一致——200 + `{"pong":true}`，query 被忽略。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
sleep 2
RESP=$(curl -sf "localhost:3001/ping?x=1&foo=bar")
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: 带 query 时 pong != true"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["pong"]' || { echo "FAIL: 带 query 时 schema 漂移"; kill $SPID; exit 1; }
kill $SPID
echo "OK: query 参数被忽略，行为一致"
```

**硬阈值**: 带任意 query → 仍 200 + `{"pong":true}`，无 4xx、无字段漂移。
**验证命令（硬阈值 codify）**: `curl -sf "localhost:3001/ping?x=1&foo=bar" | jq -e '.pong == true and (keys == ["pong"])'`

---

## E2E 验收（最终 final-e2e 跑 — target_environment=playground）

**journey_type**: autonomous
**target_environment**: playground

> 本 sprint 为 `is_skeleton: true` 的 playground 训练 sprint（PRD target_environment_reason 明确「thin_prd 推断为 playground 训练 sprint」），按 skill「playground sprint 例外」允许 `node playground/server.js`；final-e2e 不混用 Brain 5221（evaluator B33 检测）。

```bash
#!/bin/bash
set -e

# 1. 启动 playground server（干净端口 3001）
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
trap 'kill $SPID 2>/dev/null || true' EXIT
sleep 2

# 2. Golden Path 主路径：GET /ping → 200 {"pong":true}
RESP=$(curl -sf "localhost:3001/ping") || { echo "FAIL: /ping 未返回 2xx（路由未注册）"; exit 1; }
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: pong != true（实得 $RESP）"; exit 1; }
echo "$RESP" | jq -e '.pong | type == "boolean"' || { echo "FAIL: pong 非布尔类型"; exit 1; }
echo "$RESP" | jq -e 'keys == ["pong"]' || { echo "FAIL: 响应 schema 不止 pong（实得 $RESP）"; exit 1; }

# 3. 禁用字段反向：不得混入 ok（/health 字段）
echo "$RESP" | jq -e 'has("ok") | not' || { echo "FAIL: 禁用字段 ok 出现"; exit 1; }

# 4. 状态码 oracle：确实 200（非 404）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3001/ping")
[ "$CODE" = "200" ] || { echo "FAIL: 状态码 $CODE != 200"; exit 1; }

# 5. 边界：带任意 query 仍 200 {"pong":true}
RESP2=$(curl -sf "localhost:3001/ping?x=1&foo=bar")
echo "$RESP2" | jq -e '.pong == true and (keys == ["pong"])' || { echo "FAIL: 带 query 行为不一致（实得 $RESP2）"; exit 1; }

# 6. 负向行为：POST /ping → express 默认 404（不在实现范围，验证未误注册其他方法）
PCODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:3001/ping")
[ "$PCODE" = "404" ] || { echo "FAIL: POST /ping 期望 404，实得 $PCODE"; exit 1; }

echo "✅ playground /ping 冒烟验证通过"
```

**通过标准**: 脚本 exit 0（GET /ping 返回 200 + `{"pong":true}` + schema 完整 + 边界一致）。

---

## GAN 来源标注汇总

| FROM_PRD 来源步骤 | AI_ADDED 步骤 + 理由 |
|---|---|
| Step 1（发起 GET /ping）、Step 2（命中路由）、Step 3（200 {"pong":true}）、Step 4（query 忽略边界）| 无 — 本 smoke fire sprint 全部步骤可在 PRD「Golden Path」+「边界情况」原文逐条对应；未加任何 AI 健壮性步骤（PRD 已含足量验证点，遵循 B50 精简纪律不做超覆盖）|

> 说明：E2E 脚本第 6 步「POST /ping → 404」非新增 Golden Path 步骤，仅是对 PRD「边界情况」第 2 条「POST /ping 不在范围（默认 express 404）」的负向行为验证，归属 FROM_PRD。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GET /ping | `sprints/tests/ping.test.js` | 200 + pong==true（布尔）/ keys==["pong"] 完整性 / 禁用字段 ok 反向 / query 忽略边界 / POST→404 负向 | → 路由未实现时全部 FAIL（404 / pong undefined） |
