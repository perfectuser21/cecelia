# Sprint Contract Draft (Round 1)

Sprint: playground 加 `GET /ping` endpoint（harness relay 链路 smoke）
journey_type: autonomous
target_environment: playground（is_skeleton: true — PRD 明确 smoke 训练 sprint，BEHAVIOR 允许 `node playground/server.js`，禁止出现任何 Brain URL）

---

## Response Schema（推导来源: PRD字面 + playground 既有测试先例）

### Endpoint: GET /ping
**Success (HTTP 200)**:
```json
{"pong": true}
```
- `pong` (boolean, 必填, 字面值 `true`): 来源——PRD 第 20 行明确锁死（"字段名 `pong` 字面锁死"）
- keys 完整性: 顶层 keys 必须**完全等于** `["pong"]`。来源——`[AI_ADDED]` 对齐 playground 既有先例（echo.test.js `keys == ["echo"]`、/health 单键风格），堵"多加字段"缝隙

**禁用字段名**: `ping` / `alive` / `ok` / `status` / `result`（来源: PRD 第 20 行禁用清单）

**Error (非 GET 方法)**:
- `POST /ping` 等非 GET → Express 默认 404（body 为 text/html `Cannot POST /ping`，**非 JSON**——PRD 第 27 行"不注册其他方法"）。只断言状态码 404，不断言 body schema。

**Query 参数**: 无必填参数；携带任意 query 参数一律忽略，仍返回 200 `{"pong": true}`（PRD 第 26 行）。

---

## 已知约束（来自回归测试）

- [累积FR] （本 line 暂无历史——PRD 第 128 行：journeys/bb8cc561 golden-paths 返回空数组）
- context-manifest: unavailable（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回 Cannot GET，端点不存在）
- [server.test.js] → 既有 13 端点回归约束风格：strict number 正则、400 error schema `{error: string}`、keys 完整性断言、禁用 key 反向断言（260 测试，实测 3/3 全绿；本 sprint 不得使其回退）
- [echo.test.js] → **存量红（既有问题，不在本 sprint 范围）**：测试期望 `{echo: ...}`，server.js `/echo` 实际返回 `{msg: ...}`，4 个测试稳定失败（实测 3 次复跑一致）。PRD 范围限定"playground 其他既有端点改动"不在范围内 → 本合同 E2E 判据**排除 echo.test.js**，只跑 `tests/ping.test.js tests/server.test.js`。修复 /echo 属另立 sprint。

## 铁律清单加载说明（Step 1.3）

PRD 注入 area 级铁律 69 条（含重复 5 条）。逐条映射见 `contract-dod.md` 的「铁律清单 → INV 映射」段：可机检的落成 INV-1（范围越界守卫 BEHAVIOR），generator 纪律类落成本合同「Generator 执行硬条款」，其余逐条 N/A 带理由。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | `GET /ping` 返回 200 `{"pong": true}`；任意 query 参数忽略；非 GET 方法 404 |
| **NFR（做得多好）** | 性能/可靠性阈值 | PRD 第 47-50 行全部"待定/空" → 仅保底阈值：E2E 中 server 10s 内就绪、请求同步即时返回。无其他 NFR（不自加） |
| **Invariant（永不违反）** | 不变量 | ① 响应字段名 `pong` 字面锁死，禁 `ping/alive/ok/status/result`；② 只动 `playground/server.js` + `playground/tests/ping.test.js`，不触及 Brain/engine/dashboard/CI 基础设施/其他端点；③ 不新增依赖 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效谁退役 | playground 为训练沙箱教具端点，无独立退役计划，随 playground 整体存续；无 token/数据保鲜问题 |
| **死亡告警（停了谁知道）** | 停止工作谁知道 | playground 非常驻服务（仅测试时拉起），无死亡告警需求；回归失效由 CI vitest 红 + evaluator FAIL 暴露 |
| **失败语义（挂了怎么办）** | 放行还是拦截 | 见下方失败语义声明；总原则：smoke 链路任何失败一律拦截（FAIL），禁止降级放行 |
| **效果确认（已发≠已生效）** | 对外动作回执 | 唯一对外动作 = HTTP 同步响应，调用方收到响应体即生效确认；无异步动作，无回执缺口 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

（本任务无接缝判定点，N/A——全部断言为本地 express 路由的同步 HTTP 响应，无真机/生产 env/外部状态推断）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| playground server 启动失败/10s 未就绪 | E2E 显式 FAIL（exit 1），拦截 | 是（无状态，可整体重跑） | 无降级——smoke 目的就是暴露失败 |
| GET /ping 返回非 200 或 schema 不符 | 断言 FAIL（exit 1），拦截 | 是（GET 无副作用天然幂等） | 无 |
| 非 GET 方法命中 /ping | 服务端返回 Express 默认 404（预期行为，非故障） | 是 | N/A |

### 输入对抗面（对外暴露 agent 必填）

N/A——playground 为本地训练沙箱 HTTP server，不对外暴露、无不可信输入进入任何 pipeline、无 agent 交互。

---

## 接缝清单（接缝断言 vs 逻辑断言）

**本 sprint 接缝清单：空。** 全部断言为**逻辑断言**（本地 express app 路由 + supertest/curl 同步验证，环境无关）：CI/本地绿 = 真 done，无 `logic-done-pending` 项。判据：功能不碰真机、不碰生产 env、不依赖真实外部调用方（PRD journey_type_reason：无 UI / 无 engine hook / 无远端 agent 协议）。

## 真实调用方请求 shape（规则 A）

N/A——无设备/agent 调服务端场景。调用方即 evaluator/CI 的 curl 与 supertest，`GET /ping` 无参数、无认证、无 body，不存在生产调用方 shape 分叉面。

## 未覆盖真实链路清单（规则 C）

（本合同无 mock 豁免，N/A——所有 BEHAVIOR/E2E 均真启 playground server 真发 HTTP 请求，无 force_*/stub/假数据）

## 禁 mock 边清单

- 测试/E2E ↔ playground express app（本单新增 `/ping` 路由，合同测试经 supertest 直连真实 `app`、E2E 真启 `node playground/server.js` 真发 curl；禁止 mock express 路由层或伪造响应）

（本单不涉及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无其他接缝边）

---

## Golden Path

[调用方发起 GET /ping] → [playground server 路由处理] → [收到 200 {"pong": true}] →（边界：query 忽略 / 非 GET 404）→ [单测毕业全绿]

### Step 1: 调用方对已启动的 playground server 发起 GET /ping，收到 200 {"pong": true}
**来源**: `[FROM_PRD]` — PRD 第 15-20 行 Golden Path 具体步骤 1-3 直接定义

**可观测行为**: HTTP 200，响应体 JSON `{"pong": true}`

**验证命令**:
```bash
NODE_ENV= PLAYGROUND_PORT=3151 node playground/server.js & SPID=$!
for i in 1 2 3 4 5; do curl -sf localhost:3151/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done
RESP=$(curl -sf localhost:3151/ping); RC=$?
kill $SPID 2>/dev/null
[ $RC -eq 0 ] || { echo "FAIL: GET /ping 未返回 2xx"; exit 1; }
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: .pong != true"; exit 1; }
```

**硬阈值**: HTTP 200 且 `.pong == true`（jq -e 布尔严格相等），server 5s 内就绪

---

### Step 2: 携带任意 query 参数 → 忽略参数，仍 200 {"pong": true}
**来源**: `[FROM_PRD]` — PRD 第 26 行边界情况直接定义

**可观测行为**: `GET /ping?foo=bar&x=1` 返回与无参数完全相同的 200 `{"pong": true}`

**验证命令**:
```bash
NODE_ENV= PLAYGROUND_PORT=3154 node playground/server.js & SPID=$!
for i in 1 2 3 4 5; do curl -sf localhost:3154/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done
RESP=$(curl -sf "localhost:3154/ping?foo=bar&x=1"); RC=$?
kill $SPID 2>/dev/null
[ $RC -eq 0 ] || { echo "FAIL: 带 query 未返回 2xx"; exit 1; }
echo "$RESP" | jq -e '.pong == true and (keys == ["pong"])' || { echo "FAIL: 带 query 响应 schema 不符"; exit 1; }
```

**硬阈值**: HTTP 200 且 `.pong == true` 且 `keys == ["pong"]`

---

### Step 3: 非 GET 方法（POST /ping）→ Express 默认 404
**来源**: `[FROM_PRD]` — PRD 第 27 行边界情况直接定义（"不注册其他方法"）

**可观测行为**: `POST /ping` 返回 HTTP 404（Express 默认，body 非 JSON，不断言 body）

**验证命令**:
```bash
NODE_ENV= PLAYGROUND_PORT=3155 node playground/server.js & SPID=$!
for i in 1 2 3 4 5; do curl -sf localhost:3155/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3155/ping)
kill $SPID 2>/dev/null
[ "$CODE" = "404" ] || { echo "FAIL: POST /ping 期望 404 实得 $CODE"; exit 1; }
```

**硬阈值**: HTTP 状态码字面 = 404

---

### Step 4: 响应 schema 完整性 + 禁用字段反向检查
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：PRD 第 20 行锁死字段名并列出禁用清单（该清单本身 FROM_PRD），`keys == ["pong"]` 完整匹配为 AI 强化——防 generator 在 `pong` 之外附带 `status`/`ok` 等多余字段绕过字面锁死（历史 Bug 8 字段漂移同型缝隙）

**可观测行为**: 响应顶层 keys 完全等于 `["pong"]`；`ping/alive/ok/status/result` 五个禁用名均不存在

**验证命令**:
```bash
NODE_ENV= PLAYGROUND_PORT=3152 node playground/server.js & SPID=$!
for i in 1 2 3 4 5; do curl -sf localhost:3152/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done
RESP=$(curl -sf localhost:3152/ping); RC=$?
kill $SPID 2>/dev/null
[ $RC -eq 0 ] || { echo "FAIL: GET /ping 未返回 2xx"; exit 1; }
echo "$RESP" | jq -e 'keys == ["pong"]' || { echo "FAIL: keys 完整性不符"; exit 1; }
for k in ping alive ok status result; do
  echo "$RESP" | jq -e "has(\"$k\") | not" >/dev/null || { echo "FAIL: 禁用字段 $k 漏网"; exit 1; }
done
```

**硬阈值**: `keys == ["pong"]` 严格相等；5 个禁用字段 `has(x) | not` 全过

---

### Step 5: 单测毕业——ping.test.js 全绿 + server.test.js 无回退
**来源**: `[FROM_PRD]` — PRD 第 31 行（"新增 GET /ping 路由 + 对应单测文件"）+ 第 140 行 E2E 占位点 4（"playground 单测全绿（含新增 ping.test.js）"）。echo.test.js 排除理由见「已知约束」（存量红，PRD 范围外）

**可观测行为**: `npx vitest run tests/ping.test.js tests/server.test.js` 全绿（5 + 260 测试）

**验证命令**:
```bash
cd playground && npx vitest run tests/ping.test.js tests/server.test.js
```

**硬阈值**: vitest exit 0，0 failed（265 测试全过）

---

## Generator 执行硬条款（CONTRACT IS LAW）

1. **测试逐字复制**：`sprints/08061911-relay-fde0f221/tests/ping.test.js` 必须逐字复制为 `playground/tests/ping.test.js`（含头部注释），commit 1（Red）后不可修改。
2. **Red commit 只 add 精确路径** `playground/tests/ping.test.js`，禁止 `git add .` / `git add .harness/`（铁律：Red commit 精确路径）。Red 证据只跑 `npx vitest run tests/ping.test.js`（避免 echo 存量红混入证据）。
3. **Green commit 只改** `playground/server.js`（新增 `app.get('/ping', ...)` 路由一处）。
4. **禁区**：`.github/workflows/*`、`packages/*`、`apps/*`、`playground/package.json`（不新增依赖）、playground 其他既有端点代码、`echo.test.js`（存量红不许"顺手修"——范围外）。
5. **push 前本地过** lint-tdd-commit-order 与 check-test-coverage（铁律：毕业 commit 先本地跑两闸再 push）。
6. **禁 merge**：generator 只推 branch 并报告 ready，merge 权归 controller（铁律：禁止 generator 自行 merge PR）。

## TDD Red 采集方式（合同测试 Red 证据，Round 1 已实录）

合同测试 import `../server.js` 以 `playground/tests/` 为基准，Red 复现方式：
```bash
cp sprints/08061911-relay-fde0f221/tests/ping.test.js playground/tests/ping.test.js
cd playground && npx vitest run tests/ping.test.js
# Round 1 实录：Test Files 1 failed (1) / Tests 4 failed | 1 passed (5)
# （4 条正向断言全红：路由未实现返回 404；"POST /ping → 404" 为负向断言，实现前后均 404，天然绿）
```

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: playground（is_skeleton: true——本地起 `node playground/server.js` 自测，全脚本零 Brain URL）

```bash
#!/bin/bash
set -euo pipefail

# playground 训练 sprint：全程只打 playground 本地服务，禁止任何 Brain URL
cd "$(git rev-parse --show-toplevel)"
PORT=3157

# 0. 依赖就绪（幂等；playground 自带 package.json，无新增依赖）
if [ ! -d playground/node_modules ]; then
  (cd playground && npm install --no-audit --no-fund >/dev/null 2>&1)
fi

# 1. 启动 playground server（独立端口，防并发 sprint 撞车）
NODE_ENV= PLAYGROUND_PORT=$PORT node playground/server.js &
SPID=$!
trap 'kill $SPID 2>/dev/null' EXIT
for i in $(seq 1 10); do
  curl -sf "localhost:$PORT/health" | jq -e '.ok == true' >/dev/null && break
  [ "$i" = "10" ] && { echo "FAIL: server 10s 内未就绪"; exit 1; }
  sleep 1
done

# 2. GET /ping → 200 且 .pong == true
RESP=$(curl -sf "localhost:$PORT/ping") || { echo "FAIL: GET /ping 未返回 2xx"; exit 1; }
echo "$RESP" | jq -e '.pong == true' || { echo "FAIL: .pong != true"; exit 1; }

# 3. schema 完整性 + 禁用字段反向
echo "$RESP" | jq -e 'keys == ["pong"]' || { echo "FAIL: keys 完整性不符"; exit 1; }
for k in ping alive ok status result; do
  echo "$RESP" | jq -e "has(\"$k\") | not" >/dev/null || { echo "FAIL: 禁用字段 $k 漏网"; exit 1; }
done

# 4. 携带任意 query 参数 → 忽略参数仍 200 {"pong": true}
RESP2=$(curl -sf "localhost:$PORT/ping?foo=bar&x=1") || { echo "FAIL: 带 query 未返回 2xx"; exit 1; }
echo "$RESP2" | jq -e '.pong == true and (keys == ["pong"])' || { echo "FAIL: 带 query 响应 schema 不符"; exit 1; }

# 5. error path: POST /ping → Express 默认 404
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:$PORT/ping")
[ "$CODE" = "404" ] || { echo "FAIL: POST /ping 期望 404 实得 $CODE"; exit 1; }

kill $SPID 2>/dev/null
trap - EXIT

# 6. 单测毕业：新增 ping.test.js 全绿 + 既有 server.test.js 无回退
#    （echo.test.js 存量 4 红为既有问题、PRD 范围外，不纳入本 E2E 判据——见合同「已知约束」）
(cd playground && npx vitest run tests/ping.test.js tests/server.test.js)

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0
**失败标准**: 任一断言非 0 exit / server 10s 未就绪 / vitest 任一测试红

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GET /ping 基础响应 | `playground/tests/ping.test.js` | 200 + {pong: true} | → 1 failure（已实录） |
| query 参数忽略 | `playground/tests/ping.test.js` | 带任意 query 参数 | → 1 failure（已实录） |
| schema 完整性 | `playground/tests/ping.test.js` | keys 完整性 == ["pong"] | → 1 failure（已实录） |
| 禁用字段反向 | `playground/tests/ping.test.js` | 禁用 key 反向：ping/alive/ok/status/result 均不存在 | → 1 failure（已实录） |
| 非 GET 方法 404 | `playground/tests/ping.test.js` | POST /ping → 404 | → 0 failure（负向断言，实现前后均 404，天然绿——已实录 1 passed） |

Round 1 实录红证据：`Test Files 1 failed (1) / Tests 4 failed | 1 passed (5)`
