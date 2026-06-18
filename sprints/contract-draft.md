# Sprint Contract Draft (Round 4) — playground GET /ping（smoke fire）

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
# Risk R2 mitigation：poll /health 就绪再探测，替代固定 sleep
for i in $(seq 1 30); do HC=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3001/health"); [ "$HC" = "200" ] && break; [ "$i" = 30 ] && { echo "FAIL: server 未就绪（端口占用/启动失败 — R1/R2）"; kill $SPID 2>/dev/null; exit 1; }; sleep 0.5; done
curl -sf "localhost:3001/ping" | jq -e '.pong == true' || { echo "FAIL: /ping 不可达或响应异常"; kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: HTTP 请求成功建立连接并收到可解析 JSON 响应，`.pong == true`。
**验证命令（硬阈值 codify）**: `curl -sf "localhost:3001/ping" | jq -e '.pong == true'`（`-f` 使 4xx/5xx → 非 0 exit；jq -e 校验字段值）

---

### Step 2: playground server 命中 `/ping` 路由
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条「playground server 命中 `/ping` 路由」

**可观测行为**: 请求被 `/ping` 路由处理（而非落入 express 默认 404），响应状态码为 200。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3001 node server.js & SPID=$!
# Risk R2 mitigation：poll /health 就绪再探测，替代固定 sleep
for i in $(seq 1 30); do HC=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3001/health"); [ "$HC" = "200" ] && break; [ "$i" = 30 ] && { echo "FAIL: server 未就绪（端口占用/启动失败 — R1/R2）"; kill $SPID 2>/dev/null; exit 1; }; sleep 0.5; done
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
# Risk R2 mitigation：poll /health 就绪再探测，替代固定 sleep
for i in $(seq 1 30); do HC=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3001/health"); [ "$HC" = "200" ] && break; [ "$i" = 30 ] && { echo "FAIL: server 未就绪（端口占用/启动失败 — R1/R2）"; kill $SPID 2>/dev/null; exit 1; }; sleep 0.5; done
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
# Risk R2 mitigation：poll /health 就绪再探测，替代固定 sleep
for i in $(seq 1 30); do HC=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3001/health"); [ "$HC" = "200" ] && break; [ "$i" = 30 ] && { echo "FAIL: server 未就绪（端口占用/启动失败 — R1/R2）"; kill $SPID 2>/dev/null; exit 1; }; sleep 0.5; done
RESP=$(curl -sf "localhost:3001/ping?x=1&foo=bar")
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: 带 query 时 pong != true"; kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys == ["pong"]' || { echo "FAIL: 带 query 时 schema 漂移"; kill $SPID; exit 1; }
kill $SPID
echo "OK: query 参数被忽略，行为一致"
```

**硬阈值**: 带任意 query → 仍 200 + `{"pong":true}`，无 4xx、无字段漂移。
**验证命令（硬阈值 codify）**: `curl -sf "localhost:3001/ping?x=1&foo=bar" | jq -e '.pong == true and (keys == ["pong"])'`

---

## Risks（假红来源登记 — smoke fire 目标是确认管道全绿，必须杜绝下列假红）

> 本 sprint 业务逻辑零风险（`/ping` 零参数零计算）。下列 2 条是**验收执行层**的真实假红来源——它们会让管道误判为红（route 未注册/server 不可达），与 generator 实现质量无关，必须登记并在脚本中消除。不编造 PRD 无关风险。

| # | Risk（假红来源）| 触发条件 | 影响 | Mitigation（已落地到本合同验证命令 + E2E 脚本）|
|---|---|---|---|---|
| R1 | **端口被占用** — `PLAYGROUND_PORT=3001` 被其他进程占用 → server 绑定失败 → curl 连不上 → 误判 `/ping` 路由未注册（假红）| 上一轮残留 server 未回收 / 本机 3001 已被占 | 路由实现正确仍判 FAIL | 端口可覆盖：`PORT="${PLAYGROUND_PORT:-3001}"`，可指定空闲端口；启动后立即 `trap 'kill $SPID' EXIT` 确保进程回收，不跨轮泄漏端口 |
| R2 | **启动竞态** — 固定 `sleep 2` 在慢机器/CI 上不足 → server 尚未就绪即被探测 → curl 连不上 → 误判路由未注册（假红）| CI runner 冷启动 / 机器负载高，2s 内 server 未监听 | 路由实现正确仍判 FAIL | 就绪轮询替代固定 sleep：启动后 poll `/health` 直到 200（最多 15s）再跑 `/ping` 断言；超时即显式 FAIL（区分「未就绪」与「路由缺失」），不静默兜底 |

> 说明：mitigation 已落地到下方 `## E2E 验收` 脚本与本合同各 Step 验证命令、`contract-dod.md` 各 [BEHAVIOR] 命令（统一改用就绪轮询 + 可覆盖端口 + trap 回收），不仅在此栏纸面登记。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=playground）

**journey_type**: autonomous
**target_environment**: playground

> 本 sprint 为 `is_skeleton: true` 的 playground 训练 sprint（PRD target_environment_reason 明确「thin_prd 推断为 playground 训练 sprint」），按 skill「playground sprint 例外」允许 `node playground/server.js`；final-e2e 不混用 Brain 5221（evaluator B33 检测）。

```bash
#!/bin/bash
set -e

# Risk R1 mitigation：端口可覆盖（默认 3001，被占用时可指定空闲端口）
PORT="${PLAYGROUND_PORT:-3001}"

# 1. 启动 playground server；trap 确保退出时回收进程（不跨轮泄漏端口 — Risk R1）
cd playground && PLAYGROUND_PORT="$PORT" node server.js & SPID=$!
# 退出时回收 server：server 在所有正常退出点均存活 → kill 必成功（exit 0）；失败路径用显式 exit 1 不被 trap 覆盖。R4 已移除吞 exit-code 的兜底以过 Contract Gate cheat/or-true
trap 'kill $SPID 2>/dev/null' EXIT

# 1b. Risk R2 mitigation：就绪轮询替代固定 sleep —— poll /health 直到 200（最多 15s）再跑断言
READY=0
for i in $(seq 1 30); do
  HC=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT/health"); [ "$HC" = "200" ] && { READY=1; break; }
  sleep 0.5
done
[ "$READY" = "1" ] || { echo "FAIL: server 15s 内未就绪（端口 $PORT 被占用或启动失败 — Risk R1/R2，非路由缺失）"; exit 1; }

# 2. Golden Path 主路径：GET /ping → 200 {"pong":true}
RESP=$(curl -sf "localhost:$PORT/ping") || { echo "FAIL: /ping 未返回 2xx（路由未注册）"; exit 1; }
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: pong != true（实得 $RESP）"; exit 1; }
echo "$RESP" | jq -e '.pong | type == "boolean"' || { echo "FAIL: pong 非布尔类型"; exit 1; }
echo "$RESP" | jq -e 'keys == ["pong"]' || { echo "FAIL: 响应 schema 不止 pong（实得 $RESP）"; exit 1; }

# 3. 禁用字段反向：不得混入 ok（/health 字段）
echo "$RESP" | jq -e 'has("ok") | not' || { echo "FAIL: 禁用字段 ok 出现"; exit 1; }

# 4. 状态码 oracle：确实 200（非 404）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT/ping")
[ "$CODE" = "200" ] || { echo "FAIL: 状态码 $CODE != 200"; exit 1; }

# 5. 边界：带任意 query 仍 200 {"pong":true}
RESP2=$(curl -sf "localhost:$PORT/ping?x=1&foo=bar")
echo "$RESP2" | jq -e '.pong == true and (keys == ["pong"])' || { echo "FAIL: 带 query 行为不一致（实得 $RESP2）"; exit 1; }

# 6. 负向行为：POST /ping → express 默认 404（不在实现范围，验证未误注册其他方法）
PCODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:$PORT/ping")
[ "$PCODE" = "404" ] || { echo "FAIL: POST /ping 期望 404，实得 $PCODE"; exit 1; }

echo "✅ playground /ping 冒烟验证通过"
```

**通过标准**: 脚本 exit 0（GET /ping 返回 200 + `{"pong":true}` + schema 完整 + 边界一致）。

---

## GAN 来源标注汇总

| FROM_PRD 来源步骤 | AI_ADDED 步骤 + 理由 |
|---|---|
| Step 1（发起 GET /ping）、Step 2（命中路由）、Step 3（200 {"pong":true}）、Step 4（query 忽略边界）| **Round 2 加：`## Risks` R1/R2 假红来源登记 + 就绪轮询/可覆盖端口/trap 回收 mitigation**（理由：Reviewer Round 1 指出 smoke fire 目标是确认管道全绿，固定 `sleep 2` 启动竞态与端口占用是两个真实假红来源，会让正确实现误判为红——属验收执行层健壮性，非新增 Golden Path 业务步骤）；**Round 3 改：就绪轮询的 `/health` 探测改用 `-w "%{http_code}"` 状态码 oracle、Step 1 `/ping` 可达性改用 `jq -e '.pong==true'` 真值断言**（理由：Round 2 用 `curl -o /dev/null` 探测命中确定性 Contract Gate `weak-oracle/curl-no-jq`——取响应却无字段/状态码校验；改为 gate 认可的状态码 oracle + jq -e 真值断言，断言实质不变，仅消除弱 oracle 写法）；**Round 4 改：E2E 脚本 trap 清理移除 or-true 兜底**（理由：Round 3 trap 行尾用了吞 exit-code 的 or-true 兜底，命中确定性 Contract Gate `cheat/or-true`——属作弊模式；server 在所有正常退出点均存活故 kill 必成功、失败路径用显式 exit 1，移除兜底后语义不变且 gate-clean；同步对齐 Test Contract 表 Test File 至 deliverable `playground/tests/server.test.js`）|

> 说明 1：所有 Golden Path 业务步骤均 FROM_PRD，无新增业务步骤；Round 2 唯一 AI_ADDED 内容是「假红消除」的验收健壮性（Risks 栏 + 脚本就绪轮询），不改变任何被验证的行为断言。
> 说明 2：E2E 脚本第 6 步「POST /ping → 404」非新增 Golden Path 步骤，仅是对 PRD「边界情况」第 2 条「POST /ping 不在范围（默认 express 404）」的负向行为验证，归属 FROM_PRD。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GET /ping | `playground/tests/server.test.js`（deliverable，PRD 范围内的 regression test，对齐 contract-dod.md ARTIFACT）；`sprints/tests/ping.test.js` 为 GAN TDD red 阶段证据，不进 playground 交付 | 200 + pong==true（布尔）/ keys==["pong"] 完整性 / 禁用字段 ok 反向 / query 忽略边界 / POST→404 负向 | → 路由未实现时全部 FAIL（404 / pong undefined） |
