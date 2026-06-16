# Sprint Contract Draft (Round 1)

## 范围

新增**只读**端点 `GET /api/brain/harness/initiative/:id/health`，挂在 Brain 现有 harness 路由模块
`packages/brain/src/routes/harness.js`（与 `/initiative/:id/detail` 同处一文件，router 挂载在
`/api/brain/harness`）。数据来自现有表 `initiative_runs` + `initiative_run_events`，纯计算健康裁决，
不引入新表、不写库、不缓存。

## 已知约束（来自回归测试）

- [packages/brain/src/__tests__/harness-detail.test.js] → 同模块端点约定：响应顶层 keys 必须**完全等于** PRD 定义字段集合（`keys == [...]` 严格匹配）；禁用字段反向断言（`steps/timeline/result/data/details/info/content/report` 不得出现）；不存在 → 404 + `error` (string)；用 supertest + `vi.mock` db.js 单测。
- [packages/brain/src/routes/harness.js:42-48] → UUID 校验统一用 `UUID_RE`，非法 → `400 {error:"invalid ...: must be a UUID"}`。
- [packages/brain/src/routes/harness.js:62/117/157] → 资源不存在统一 `404 {error:"... not found"}`；500 用 `{error: err.message}`。
- [migration 279/293] → `initiative_run_events(id BIGSERIAL, initiative_id UUID, node TEXT, status TEXT CHECK IN('running','done','failed','completed'), attempt INT DEFAULT 1, ts BIGINT 即 Unix 秒, ts_end, cost_usd, model)`。
- [migration 238] → `initiative_runs(id UUID PK, initiative_id UUID, phase TEXT CHECK IN('A_contract','B_task_loop','C_final_e2e','done','failed'), started_at, completed_at, failure_reason, created_at, updated_at, ...)`。

---

## Response Schema（推导来源: PRD 字面 + api_registry 不可达，回退读同模块 `/detail` 端点约定）

> Registry 端点（localhost:5221）在本环境不可达，按 Step 1.1 回退规则：直接读同文件 `/initiative/:id/detail`
> 已落地的命名约定推导，PRD 已字面锚定 7 个字段名（healthy/state/last_node/retries/interrupts/stuck_minutes/reason）。

### Endpoint: `GET /api/brain/harness/initiative/:id/health`

**Success (HTTP 200)**:
```json
{
  "healthy": true,
  "state": "running",
  "last_node": "generator",
  "retries": 0,
  "interrupts": 0,
  "stuck_minutes": 1,
  "reason": "Run 正在 generator 节点正常推进"
}
```

- `healthy` (boolean, 必填): 来源——PRD 明确。`true` 当且仅当 `state ∈ {running, completed}`。
- `state` (string, 必填): 来源——PRD 明确（"健康在跑 / 卡住 / 僵尸 / 已完成 / 已失败"）。枚举值固定：
  `running` | `stuck` | `zombie` | `completed` | `failed` | `no_data`。
- `last_node` (string|null, 必填): 来源——PRD 明确。最新一条事件的 `node`；无事件时为 `null`。
- `retries` (number, 必填): 来源——PRD 明确。`MAX(attempt) - 1`（仅统计 `node = last_node` 的事件），>= 0。
- `interrupts` (number, 必填): 来源——PRD 明确。`count(events WHERE status='failed')`，>= 0。
- `stuck_minutes` (number, 必填): 来源——PRD 明确。`floor((NOW_unix - last_event.ts) / 60)`，>= 0；无事件时为 0。
- `reason` (string, 必填): 来源——PRD 明确。一句话人类可读裁决说明。

**禁用字段名**（推导自 `/detail` 端点禁用清单 + 本端点同义替换词，contract 正向断言绝不出现，只可 `not has(...)`）:
`status`（应为 `state`）、`node`（应为 `last_node`）、`health`（应为 `healthy`）、`message`（应为 `reason`）、
`stuck`、`retry`、`data`、`result`、`details`、`steps`、`timeline`、`initiative_id`（本端点 schema 只含上述 7 字段，不外带 id）。

**Schema 完整性**: 顶层 keys **完全等于**（排序后）：
`["healthy","interrupts","last_node","reason","retries","state","stuck_minutes"]`（7 字段，不多不少）。

**Error (HTTP 400 — 非法 UUID)**:
```json
{"error": "invalid initiative id: must be a UUID"}
```

**Error (HTTP 404 — 合法但 initiative_runs 无该 run)**:
```json
{"error": "initiative run not found"}
```

---

## 健康裁决逻辑（纯计算，psql 可比对验证）

```
run  = SELECT phase, started_at, completed_at, failure_reason
        FROM initiative_runs WHERE initiative_id = :id ORDER BY created_at DESC LIMIT 1
if run 不存在 → 404 {error:"initiative run not found"}

events = SELECT node, status, attempt, ts FROM initiative_run_events
          WHERE initiative_id = :id ORDER BY ts ASC

if events 为空:
  → 200 { healthy:false, state:"no_data", last_node:null, retries:0,
          interrupts:0, stuck_minutes:0, reason:"该 Run 尚无节点事件（未开始或无数据）" }

last          = events 中 ts 最大的一条
last_node     = last.node
retries       = MAX(attempt for events WHERE node = last_node) - 1        # >= 0
interrupts    = count(events WHERE status = 'failed')                      # >= 0
stuck_minutes = floor((floor(Date.now()/1000) - last.ts) / 60)            # 钳 >= 0

裁决阈值（常量，写进源码）：
  STUCK_MINUTES  = 15
  ZOMBIE_MINUTES = 60

if    run.phase = 'done'    → state="completed", healthy=true,  reason="Run 已完成（phase=done）"
elif  run.phase = 'failed'  → state="failed",    healthy=false, reason=(failure_reason || "Run 已失败（phase=failed）")
else  # 进行中 phase ∈ {A_contract, B_task_loop, C_final_e2e}
  if   stuck_minutes >= ZOMBIE_MINUTES                              → state="zombie",  healthy=false
  elif stuck_minutes >= STUCK_MINUTES  OR  (retries >= 1 AND last.status = 'failed') → state="stuck", healthy=false
  else                                                              → state="running", healthy=true
```

> **stuck vs zombie 区分依据**（PRD 边界要求）：`zombie` = 超过 60 分钟无任何事件推进（实质已死/被遗弃）；
> `stuck` = 15~60 分钟未推进，或当前节点在反复重试（`retries>=1` 且最后一条状态 `failed`）但尚有救。
> PRD 异常分支「卡在 prep 反复重试」→ 命中 `stuck`（last_node=prep, retries=N, stuck_minutes=N），与 PRD 字面一致。

---

## Golden Path

[主理人 GET /initiative/:id/health] → [系统读 initiative_runs + initiative_run_events 做裁决] → [返回 200 + 7 字段健康 JSON]

### Step 1: 主理人调健康端点（传真实 initiative_id）
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「主理人调 `GET /api/brain/harness/initiative/:id/health`」

**可观测行为**: 端点存在并响应（路由已注册，非通用 404）；合法且存在的 id 返回 HTTP 200 + JSON body。

**验证命令**:
```bash
# 先 INSERT 受控测试数据（见 ## E2E 验收），再：
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health")
echo "$RESP" | jq -e 'has("healthy") and has("state") and has("last_node")' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: HTTP 200 且 body 含 7 字段（404 = 路由未注册 = FAIL，不接受 404-acceptable 旁路）。
**验证命令（硬阈值机检）**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/$IID/health"); [ "$CODE" = "200" ] || { echo "FAIL: code=$CODE（404=路由未注册）"; exit 1; }
```

---

### Step 2: 系统读两表做健康裁决（running 健康态）
**来源**: `[FROM_PRD]` — Golden Path 第 2 步「系统读 `initiative_runs` + `initiative_run_events`，综合状态/最后节点/重试/中断/卡住时长做裁决」

**可观测行为**: 对一个最近有事件、进行中的 run → `state=running`、`healthy=true`、`last_node` 等于最新事件 node。

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID_RUNNING/health")
echo "$RESP" | jq -e '.state == "running" and .healthy == true' || { echo FAIL; exit 1; }
# psql 比对 last_node 计算正确：
DB_LAST=$(psql "$DB" -t -c "SELECT node FROM initiative_run_events WHERE initiative_id='$IID_RUNNING' ORDER BY ts DESC LIMIT 1" | tr -d ' ')
echo "$RESP" | jq -e --arg n "$DB_LAST" '.last_node == $n' || { echo "FAIL: last_node 与 DB 不符"; exit 1; }
echo OK
```
**硬阈值**: `state=running`、`healthy=true`、`last_node` == DB 最新事件 node、`stuck_minutes < 15`。

---

### Step 3: 返回一句话健康判断 JSON（7 字段完整 + schema 严格）
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「返回 200 + JSON，含 healthy/state/last_node/retries/interrupts/stuck_minutes/reason」

**可观测行为**: 顶层 keys 恰好 7 个 PRD 字段；类型正确；`reason` 非空字符串。

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID_RUNNING/health")
echo "$RESP" | jq -e 'keys == ["healthy","interrupts","last_node","reason","retries","state","stuck_minutes"]' || { echo "FAIL: schema 不严格"; exit 1; }
echo "$RESP" | jq -e '(.reason | type=="string") and (.reason|length>0)' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: `keys` 排序后完全等于 7 字段集合，多一个少一个均 FAIL。

---

### Step 4 (异常分支): 卡在 prep 反复重试的 Run → state=stuck
**来源**: `[FROM_PRD]` — PRD 异常分支「传一个『卡在 prep 反复重试』的 Run id → 返回 `state=stuck`（含 stuck_minutes=N、retries=N、last_node=prep）」

**可观测行为**: last_node=prep、retries≥1、stuck_minutes≥15、state=stuck、healthy=false。

**验证命令**:
```bash
# 受控数据：prep attempt 1,2 均 failed → retries = MAX(attempt)-1 = 1，interrupts = failed 计数 = 2
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID_STUCK/health")
echo "$RESP" | jq -e '.state=="stuck" and .healthy==false and .last_node=="prep" and .retries==1 and .interrupts==2 and .stuck_minutes>=15 and .stuck_minutes<60' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: state=stuck、last_node=prep、retries==1、interrupts==2（对应受控注入的 prep×2 failed 事件）、stuck_minutes∈[15,60)。

---

### Step 5 (异常分支): 长时间无推进的 Run → state=zombie
**来源**: `[FROM_PRD]` — PRD Golden Path / 边界「一眼看出 …… 僵尸 ……」+「stuck vs zombie 区分依据 stuck_minutes 与重试/中断信号」

**可观测行为**: 进行中 phase 但最后事件距今 ≥ 60 分钟 → state=zombie、healthy=false。

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID_ZOMBIE/health")
echo "$RESP" | jq -e '.state=="zombie" and .healthy==false and .stuck_minutes>=60' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: stuck_minutes≥60 时 state=zombie（与 stuck 严格区分，15≤x<60 才是 stuck）。

---

### Step 6 (异常分支): 已完成 / 已失败的 Run
**来源**: `[FROM_PRD]` — PRD Golden Path「一眼看出 …… 已完成 / 已失败」

**可观测行为**: phase=done → state=completed/healthy=true；phase=failed → state=failed/healthy=false。

**验证命令**:
```bash
RC=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID_DONE/health");   echo "$RC" | jq -e '.state=="completed" and .healthy==true'  || { echo FAIL; exit 1; }
RF=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID_FAILED/health"); echo "$RF" | jq -e '.state=="failed" and .healthy==false'    || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: phase=done↔completed/healthy=true；phase=failed↔failed/healthy=false。

---

### Step 7 (边界情况): initiative_runs 存在但无任何事件 → state=no_data（不报 500）
**来源**: `[FROM_PRD]` — PRD 边界情况「该 initiative 存在但还没有任何 run 事件 → 给出可解释裁决，不报 500」

**可观测行为**: HTTP 200、state=no_data、last_node=null、retries=0、interrupts=0、stuck_minutes=0、reason 可解释。

**验证命令**:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID_NODATA/health")
echo "$RESP" | jq -e '.state=="no_data" and .last_node==null and .retries==0 and .interrupts==0 and .stuck_minutes==0 and (.reason|length>0)' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: HTTP 200（绝不 500），state=no_data，last_node 为 null。

---

### Step 8 (异常分支): 非法 UUID → 400；合法但不存在 → 404
**来源**: `[FROM_PRD]` — PRD 异常分支「非法 UUID → 400 + error；合法但不存在 → 404 + error（区分 ID 写错 vs Run 不存在）」

**可观测行为**: `not-a-uuid` → 400 + `error` (string)；合法但 initiative_runs 无记录的 UUID → 404 + `error` (string)。

**验证命令**:
```bash
C400=$(curl -s -o /tmp/h400.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/not-a-uuid/health"); [ "$C400" = "400" ] || { echo "FAIL: 非法 UUID 应 400 实为 $C400"; exit 1; }
jq -e '.error | type=="string"' /tmp/h400.json || { echo FAIL; exit 1; }
C404=$(curl -s -o /tmp/h404.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-0000000000ff/health"); [ "$C404" = "404" ] || { echo "FAIL: 不存在应 404 实为 $C404"; exit 1; }
jq -e '.error | type=="string"' /tmp/h404.json || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: 400 与 404 必须区分（400=ID 格式错，404=Run 不存在），均带 `error` (string)。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api，curl + psql）

**journey_type**: autonomous
**target_environment**: local_api

> 本端点为只读，E2E 用受控合成数据：为每个场景生成独立随机 `initiative_id`（防造假——避免读到历史残留），
> INSERT 受控 `initiative_runs` + `initiative_run_events`（ts 用 `NOW_unix - 偏移` 精确控制 stuck_minutes），
> curl 健康端点断言裁决，psql 反查计算字段一致，最后 cleanup 删除全部测试行。
> **防造假说明** `[AI_ADDED]`（理由：随机 uuid + 用例后 cleanup，确保每次 E2E 读到的是本轮 INSERT 的数据而非历史残留，使 stuck_minutes/retries 断言不可被历史数据蒙混）。

```bash
#!/bin/bash
set -e
DB="${DB:-postgresql://localhost/cecelia}"
BASE="localhost:5221/api/brain/harness/initiative"
NOW=$(date +%s)

# 生成 5 个独立随机 initiative_id（防造假隔离）
IID_RUNNING=$(uuidgen | tr 'A-Z' 'a-z')
IID_STUCK=$(uuidgen | tr 'A-Z' 'a-z')
IID_ZOMBIE=$(uuidgen | tr 'A-Z' 'a-z')
IID_DONE=$(uuidgen | tr 'A-Z' 'a-z')
IID_FAILED=$(uuidgen | tr 'A-Z' 'a-z')
IID_NODATA=$(uuidgen | tr 'A-Z' 'a-z')
ALL_IIDS="'$IID_RUNNING','$IID_STUCK','$IID_ZOMBIE','$IID_DONE','$IID_FAILED','$IID_NODATA'"

cleanup() {
  psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id IN ($ALL_IIDS)" >/dev/null 2>&1
  psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id IN ($ALL_IIDS)" >/dev/null 2>&1
}
trap cleanup EXIT

# ---- 注入受控数据 ----
# running：进行中 + 最近事件（1 分钟前）
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID_RUNNING','B_task_loop')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('$IID_RUNNING','generator','running',1,$((NOW-60)))"

# stuck：prep 反复重试（attempt 1,2 均 failed），最后事件 30 分钟前
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID_STUCK','B_task_loop')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES
  ('$IID_STUCK','prep','failed',1,$((NOW-2400))),
  ('$IID_STUCK','prep','failed',2,$((NOW-1800)))"

# zombie：进行中但最后事件 120 分钟前
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID_ZOMBIE','A_contract')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('$IID_ZOMBIE','planner','running',1,$((NOW-7200)))"

# done / failed
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID_DONE','done')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('$IID_DONE','report','completed',1,$((NOW-120)))"
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase, failure_reason) VALUES ('$IID_FAILED','failed','evaluator FAIL x3')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('$IID_FAILED','evaluator','failed',3,$((NOW-300)))"

# no_data：仅有 run 行，无事件
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID_NODATA','A_contract')"

# ---- 断言 ----
R=$(curl -sf "$BASE/$IID_RUNNING/health"); echo "$R" | jq -e '.state=="running" and .healthy==true and .last_node=="generator" and .stuck_minutes<15' || { echo "FAIL running: $R"; exit 1; }

R=$(curl -sf "$BASE/$IID_STUCK/health"); echo "$R" | jq -e '.state=="stuck" and .healthy==false and .last_node=="prep" and .retries==1 and .interrupts==2 and .stuck_minutes>=15 and .stuck_minutes<60' || { echo "FAIL stuck: $R"; exit 1; }

R=$(curl -sf "$BASE/$IID_ZOMBIE/health"); echo "$R" | jq -e '.state=="zombie" and .healthy==false and .stuck_minutes>=60' || { echo "FAIL zombie: $R"; exit 1; }

R=$(curl -sf "$BASE/$IID_DONE/health"); echo "$R" | jq -e '.state=="completed" and .healthy==true' || { echo "FAIL done: $R"; exit 1; }

R=$(curl -sf "$BASE/$IID_FAILED/health"); echo "$R" | jq -e '.state=="failed" and .healthy==false' || { echo "FAIL failed: $R"; exit 1; }

R=$(curl -sf "$BASE/$IID_NODATA/health"); echo "$R" | jq -e '.state=="no_data" and .last_node==null and .retries==0 and .interrupts==0 and .stuck_minutes==0 and (.reason|length>0)' || { echo "FAIL no_data: $R"; exit 1; }

# schema 严格 + 禁用字段反向
R=$(curl -sf "$BASE/$IID_RUNNING/health")
echo "$R" | jq -e 'keys == ["healthy","interrupts","last_node","reason","retries","state","stuck_minutes"]' || { echo "FAIL schema: $R"; exit 1; }
echo "$R" | jq -e '(has("status")|not) and (has("node")|not) and (has("health")|not) and (has("message")|not)' || { echo "FAIL banned: $R"; exit 1; }

# 错误路径
C=$(curl -s -o /tmp/e400.json -w "%{http_code}" "$BASE/not-a-uuid/health"); [ "$C" = "400" ] || { echo "FAIL 400: $C"; exit 1; }; jq -e '.error|type=="string"' /tmp/e400.json || exit 1
C=$(curl -s -o /tmp/e404.json -w "%{http_code}" "$BASE/00000000-0000-0000-0000-0000000000ff/health"); [ "$C" = "404" ] || { echo "FAIL 404: $C"; exit 1; }; jq -e '.error|type=="string"' /tmp/e404.json || exit 1

echo "✅ Golden Path 全场景验证通过（running/stuck/zombie/completed/failed/no_data + schema + 400/404）"
```

**通过标准**: 脚本 exit 0（trap cleanup 保证测试数据不残留）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| health 端点裁决 + schema + 错误路径 | `tests/health-endpoint.test.ts` | running/stuck/zombie/completed/failed/no_data 六态 + schema 严格 + 禁用字段 + 400/404 | 端点未实现 → 路由 404 → 全部断言 FAIL |
