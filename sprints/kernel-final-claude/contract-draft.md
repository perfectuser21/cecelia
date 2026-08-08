# Sprint Contract Draft (Round 1) — playground GET /kernel-pong

> journey_type: autonomous ｜ target_environment: playground（is_skeleton 训练 sprint，PRD 明确 playground 载体）
> contract-gate: 本仓存在 packages/brain/src/lib/contract-gate.js → 代码层 Contract Gate 生效，断言按速查表惯用法书写
> gp-anchor: skipped (product-map.json not found)

## 锚定父路声明

独立小路（无父路）——本 sprint 是 kernel 全链穿透终验 B 的最小载体，journey e6f803f2 golden-paths 查询为空（PRD 累积 FR 段确认本 line 暂无历史），无既有父 Golden Path 可挂。

## 验证真相形态预声明（Invariant: local验证真相形态）

本 sprint 无 UI，验证真相形态 = **curl HTTP 200 + jq 断言 body + 进程 exit code**。所有 [BEHAVIOR] 与 E2E 均以此形态落地，位置词红线：只测 `localhost:$PLAYGROUND_PORT`（playground 本地 express），**严禁** `localhost:5221/api/brain/*`（Invariant: playground-e2e-端口）。

## Response Schema（推导来源: PRD 字面 + playground 既有 /ping 幂等约定）

### Endpoint: GET /kernel-pong

**Success (HTTP 200)**:
```json
{"pong": true}
```
- `pong` (boolean, 必填): 来源——PRD Golden Path 第 3 步字面 `{ "pong": true }`，与既有 `GET /ping`（server.js: `res.json({ pong: true })`）逐字段一致
- 顶层 keys 完整性：`keys == ["pong"]`（不允许多余字段，沿用 /ping 的 `Object.keys(body) === ['pong']` 约定）

**禁用字段名**: `ping` / `alive` / `ok` / `status` / `result` / `kernel` / `kernelPong` / `message`（来自 /ping 现有禁用清单 + 本端点语义同义替换词，防 generator 漂移成 `{ kernel: "pong" }` / `{ ok: true }` 等）

**Error (无 Success 之外的显式 error body)**:
- 非 GET 方法（POST/PUT…）→ Express 默认 404（PRD 边界：不注册非 GET 方法）。本 sprint 不新增自定义 error JSON。

---

## 已知约束（来自回归测试 + 累积 FR）

- [playground/tests/ping.test.js] → `GET /ping → 200 + {pong: true}`（响应形态直接被本端点沿用）
- [playground/tests/ping.test.js] → `response keys 完整性 == ["pong"]（不允许多余字段）`
- [playground/tests/ping.test.js] → `POST /ping → 404（不注册非 GET 方法）`
- [累积FR] （本 line 暂无历史——PRD 累积 FR 段确认，context-manifest 未注入新增 FR）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | playground express 新增 `GET /kernel-pong` 路由，返回 HTTP 200 + `{ "pong": true }`；带任意 query 参数忽略仍 200 |
| **NFR（做得多好）** | 性能/可靠 | 本地端点响应 <100ms（PRD NFR）；纯内存无 IO |
| **Invariant（永不违反）** | 不变量 | ①e2e 只测 `localhost:$PLAYGROUND_PORT`，禁 `localhost:5221/api/brain/*`；②不改动 /ping 及其他既有端点；③不改 Brain/dashboard/engine |
| **判定点（怎么知道）** | 对模糊现实的判断 | （本任务无接缝判定点，N/A——纯本地确定性 HTTP 端点，无外部真实状态推断） |
| **保质期（何时过期）** | 失效条件 | 端点常驻，无 token/凭据，无保质期 |
| **死亡告警（停了谁知道）** | 告警 | N/A（playground 训练端点，无生产告警要求；回归测试 CI 挂 = 已知） |
| **失败语义（挂了怎么办）** | 故障策略 | 端点为纯读、幂等；无写路径无重试语义；进程崩溃即整 playground 不可用，由 e2e 启停自持 |
| **效果确认（已发≠已生效）** | 回执 | curl HTTP 200 + jq `.pong==true` 即真实生效回执，无异步链路 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |

（本任务无接缝判定点，N/A——GET /kernel-pong 是本地确定性 express 路由，不推断任何外部真实状态）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| GET /kernel-pong 端口被占用 | server.listen 抛错，进程退出 | 是（GET 纯读幂等） | e2e 脚本自选空闲端口（PLAYGROUND_PORT 覆盖） |
| 非 GET 方法访问 | Express 默认 404 | 是 | 不在断言范围（PRD 边界） |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| — | — | — | — |

N/A——本端点不接受任何被信任的自然语言输入，无 agent 暴露面，query 参数被完全忽略。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 禁 mock 边清单

（本单纯端点新增改动：新增一条 express GET 路由，不涉及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无接缝边，N/A。合同 tests/ 用 supertest 直打真实 `import app from '../server.js'`，不 mock 任何被测路径。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A——所有断言真启 express 应用真发 HTTP 请求，无 force_*/stub/假数据。）

## 真实调用方请求 shape

N/A——无设备/agent 调服务端；调用方为标准 HTTP 客户端 curl，GET 无认证无 body。

---

## Golden Path

[启动 playground（node playground/server.js）] → [GET /kernel-pong 无参数] → [HTTP 200 + {"pong": true}]

### Step 1: 启动 playground 服务
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步「启动 playground 服务：`node playground/server.js`」

**可观测行为**: 进程监听 `$PLAYGROUND_PORT`（默认 3000），`/health` 就绪返回 `{ ok: true }`

**验证命令**:
```bash
PLAYGROUND_PORT=3130 node playground/server.js & SP=$!; sleep 1
curl -sf localhost:3130/health | jq -e '.ok==true'; kill $SP
# 期望：exit 0
```
**硬阈值**: server 1s 内就绪，`/health` 返回 `.ok==true`

---

### Step 2: GET /kernel-pong 返回 pong
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2-3 步「GET /kernel-pong → HTTP 200 + `{ "pong": true }`」

**可观测行为**: `GET /kernel-pong` 返回 HTTP 200，body 恰为 `{"pong": true}`

**验证命令**:
```bash
PLAYGROUND_PORT=3131 node playground/server.js & SP=$!; sleep 1
RESP=$(curl -sf localhost:3131/kernel-pong) || { kill $SP; echo "FAIL: 未返回 2xx"; exit 1; }
kill $SP
echo "$RESP" | jq -e '.pong==true and (keys==["pong"])'
# 期望：exit 0（.pong==true 且 keys 完整性；curl -f 保证 404 时提前 FAIL，不吞空响应假绿）
```
**硬阈值**: HTTP 200，`.pong==true`，`keys==["pong"]`

---

### Step 3: 带 query 参数忽略仍返回 pong（边界）
**来源**: `[FROM_PRD]` — PRD 边界情况「带任意 query 参数：仍返回 200 + `{ "pong": true }`」

**可观测行为**: `GET /kernel-pong?x=1` 仍返回 200 + `{"pong": true}`

**验证命令**:
```bash
PLAYGROUND_PORT=3132 node playground/server.js & SP=$!; sleep 1
RESP=$(curl -sf 'localhost:3132/kernel-pong?x=1&foo=bar') || { kill $SP; echo "FAIL: 带 query 未返回 2xx"; exit 1; }
kill $SP
echo "$RESP" | jq -e '.pong==true'
# 期望：exit 0
```
**硬阈值**: HTTP 200，`.pong==true`

---

### Step 4: 非 GET 方法返回 404（边界/防造假）
**来源**: `[AI_ADDED]` — 理由：PRD 边界写「非 GET 方法走 express 默认 404，不在断言范围」；此处加一条反向断言防 generator 用 `app.all` / `app.use` 兜底导致所有方法都 200 的假绿路由

**可观测行为**: `POST /kernel-pong` 返回 404（Express 默认，无自定义 body）

**验证命令**:
```bash
PLAYGROUND_PORT=3133 node playground/server.js & SP=$!; sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3133/kernel-pong); kill $SP
[ "$CODE" = "404" ]
# 期望：exit 0（POST → 404）
```
**硬阈值**: POST 返回 HTTP 404

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本 sprint 为极简端点，低风险）
高风险面:
- 错输入: `GET /kernel-pong` 带畸形 query（超长值 `?x=<10000字符>`、控制字符）→ 仍应 200 + `{"pong":true}`，不得 5xx
- 重复提交: 连续 100 次 `GET /kernel-pong` → 每次都 200 + `{"pong":true}`（幂等，无状态泄漏）
- 中途中断: server 启动后立即 curl（就绪竞态）→ 允许首个连接失败重试，但就绪后必稳定
- 边界值: 相邻路径 `GET /kernel-pon` / `GET /kernel-pong/` → 前者 404，后者按 express 路由约定（不得误命中）
发现分级: P0/P1（端点 5xx / 返回非 `{"pong":true}` / 污染既有 /ping）→ 阻塞 merge；P2/P3（trailing slash 行为差异等）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=playground）

**journey_type**: autonomous
**target_environment**: playground

> 位置词红线：只测 `localhost:$PLAYGROUND_PORT`（本地 express），禁止 `localhost:5221/api/brain/*`（Invariant: playground-e2e-端口）。
> 真相形态：curl HTTP 200 + jq body 断言 + 进程 exit code。

```bash
#!/bin/bash
set -euo pipefail

# 选一个空闲端口（PRD 边界：端口被占用由 PLAYGROUND_PORT 覆盖，e2e 自选空闲端口）
PORT="${PLAYGROUND_PORT:-3139}"
SERVER_PID=""
cleanup() { [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# 1. 启动 playground（Golden Path Step 1）
PLAYGROUND_PORT="$PORT" node playground/server.js >/tmp/kernel-pong-e2e.log 2>&1 &
SERVER_PID=$!

# 等待就绪（最多 30 次，1s 间隔）
for i in $(seq 1 30); do
  curl -sf "localhost:$PORT/health" >/dev/null 2>&1 && break
  [ "$i" = "30" ] && { echo "FAIL: playground 30s 内未就绪"; exit 1; }
  sleep 1
done
echo "✅ playground 就绪 port=$PORT"

# 2. GET /kernel-pong（Golden Path Step 2）— 200 + {"pong": true} + keys 完整性
RESP=$(curl -sf "localhost:$PORT/kernel-pong") || { echo "FAIL: /kernel-pong 未返回 2xx"; exit 1; }
echo "$RESP" | jq -e '.pong == true' >/dev/null || { echo "FAIL: .pong != true，实际=$RESP"; exit 1; }
echo "$RESP" | jq -e 'keys == ["pong"]' >/dev/null || { echo "FAIL: keys != [pong]，实际=$RESP"; exit 1; }
echo "$RESP" | jq -e 'has("kernel") or has("ok") or has("result") or has("message") | not' >/dev/null || { echo "FAIL: 出现禁用字段，实际=$RESP"; exit 1; }
echo "✅ GET /kernel-pong → 200 {\"pong\":true}"

# 3. 带 query 参数忽略仍 pong（Golden Path Step 3）
RESP2=$(curl -sf "localhost:$PORT/kernel-pong?x=1&foo=bar") || { echo "FAIL: 带 query 未返回 2xx"; exit 1; }
echo "$RESP2" | jq -e '.pong == true' >/dev/null || { echo "FAIL: 带 query .pong != true，实际=$RESP2"; exit 1; }
echo "✅ GET /kernel-pong?x=1 → 忽略参数仍 {\"pong\":true}"

# 4. 非 GET 方法 → 404（Golden Path Step 4）
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "localhost:$PORT/kernel-pong")
[ "$CODE" = "404" ] || { echo "FAIL: POST /kernel-pong 期望 404 实际=$CODE（疑似 app.all/app.use 兜底假绿）"; exit 1; }
echo "✅ POST /kernel-pong → 404"

# 5. 既有 /ping 未被污染（Invariant: 不改动既有端点）
PING=$(curl -sf "localhost:$PORT/ping") || { echo "FAIL: 既有 /ping 回归失败"; exit 1; }
echo "$PING" | jq -e '.pong == true and (keys == ["pong"])' >/dev/null || { echo "FAIL: /ping 被污染，实际=$PING"; exit 1; }
echo "✅ 既有 /ping 回归通过"

echo "✅ Golden Path 全程验证通过（kernel-pong 终验 B）"
```

---

## TDD Red 采集方式

`playground/tests/kernel-pong.test.js` 内 `import app from '../server.js'`（相对 playground/tests/）。Red 证据在 generator 实现 `/kernel-pong` 路由**之前**采集：`cd playground && npx vitest run tests/kernel-pong.test.js` → 全部 FAIL（`GET /kernel-pong` 命中 express 默认 404，`res.status` 为 404 而非 200，断言失败）。generator 补路由后转 Green。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GET /kernel-pong | `playground/tests/kernel-pong.test.js` | `200 + {pong: true}`; `带任意 query 参数`; `keys 完整性 == ["pong"]`; `禁用 key 反向`; `POST /kernel-pong → 404` | → 5 failures（路由未注册，全部命中默认 404）|
