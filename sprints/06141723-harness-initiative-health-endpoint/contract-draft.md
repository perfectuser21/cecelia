# Sprint Contract Draft (Round 1)

> Sprint: Harness Initiative 健康度只读端点 `GET /api/brain/harness/initiative/:id/health`
> journey_type: autonomous ｜ target_environment: local_api

## 已知约束（来自回归测试）

- [harness-artifact-gate.test.js] generator 只写 Red 测试不实现路由会被 ARTIFACT 门拦截 → 本合同 ARTIFACT 段必须断言 `harness.js` 实含 `/initiative/:id/health` 路由字面量
- [harness.js 现有端点] `/initiative-runs/:id`、`/runs/:id`、`/runs/:id/progress` 已确立惯用法：UUID 校验用模块级 `UUID_RE`，非法 → 400 `{error}`，无记录 → 404 `{error}`，异常 → 500 `{error: err.message}`，响应含 `initiative_id` 字段。新端点必须复用同一套惯用法。

## Response Schema（推导来源: PRD 字面 + harness.js 现有端点模式）

### Endpoint: GET /api/brain/harness/initiative/:id/health
**Success (HTTP 200)**:
```json
{
  "initiative_id": "<uuid>",
  "healthy": true,
  "state": "healthy",
  "last_node": "prep",
  "retries": 0,
  "interrupts": 0,
  "stuck_minutes": 0,
  "reason": "run is progressing; last activity 0m ago at node prep"
}
```
- `initiative_id` (string, 必填): 来源——api_registry 不可用，按 harness.js 现有端点（detail/progress/initiative-runs 均返回 `initiative_id`）模式补入；标 `[AI_ADDED]`
- `healthy` (boolean, 必填): 来源——PRD Golden Path 步骤3 字面 `healthy（布尔）`
- `state` (string 枚举 `healthy|stuck|zombie|completed|failed`, 必填): 来源——PRD 步骤3 字面
- `last_node` (string|null, 必填): 来源——PRD 步骤3 字面 `last_node（当前/最后所在节点，如 prep）`；无任何 event 时为 `null`（PRD 边界「无 events 不报错」）
- `retries` (number, 必填): 来源——PRD 步骤3 字面
- `interrupts` (number, 必填): 来源——PRD 步骤3 字面
- `stuck_minutes` (number, 必填): 来源——PRD 步骤3 字面
- `reason` (string, 必填): 来源——PRD 步骤3 字面 `reason（一句话判定依据）`

**禁用字段名**: [`status`（与 `state` 同义，禁混用）, `phase`（DB 内部列名，不可直接外泄为响应键）, `node`（须用 `last_node`）, `health`（须用 `healthy` 布尔）]

**Error (HTTP 400 / 404)**:
```json
{"error": "<string>"}
```
- 非法 UUID → 400 `{"error": "invalid initiative_id: must be a UUID"}`
- 合法 UUID 但无 run → 404 `{"error": "initiative run not found"}`

### 健康裁决逻辑（字段计算口径，generator 必须按此实现）

数据源（纯只读，两表）：
- `initiative_runs`：取该 initiative **最新一条** run（`ORDER BY created_at DESC LIMIT 1`），读 `phase`
- `initiative_run_events`：该 initiative 全部 events，读 `node` / `status` / `attempt` / `ts`(BIGINT Unix 秒)

派生字段：
- `last_node` = events 中 `ts` 最大那条的 `node`；无 events → `null`
- `retries` = `GREATEST(MAX(attempt) - 1, 0)`（无 events → 0）
- `interrupts` = events 中 `status = 'failed'` 的条数（无 events → 0）
- `last_activity_ts` = `MAX(ts)`（无 events → run.started_at 的 epoch 秒）
- `stuck_minutes` = `floor((now_epoch - last_activity_ts) / 60)`；终态(done/failed)恒为 0

state 判定（**阈值 [AI_ADDED]，对齐现有 harness-watchdog 常量 staleMinutes=10 / staleMinutesA=20，防止 generator 自创阈值**）：
- `phase = 'done'`  → `state='completed'`, `healthy=true`,  `stuck_minutes=0`
- `phase = 'failed'`→ `state='failed'`,    `healthy=false`
- 运行中(phase A_contract/B_task_loop/C_final_e2e)：
  - `stuck_minutes >= 20` → `state='zombie'`, `healthy=false`
  - `stuck_minutes >= 10` → `state='stuck'`,  `healthy=false`
  - 否则                  → `state='healthy'`,`healthy=true`

## Golden Path

[主理人 GET /health] → [校验 UUID] → [读 initiative_runs 最新 run + initiative_run_events] → [裁决 state] → [200 JSON 一句话健康] / [400|404 error]

### Step 1: 主理人对合法且存在的 initiative 调端点，拿到 200 + 健康 JSON
**来源**: `[FROM_PRD]` — Golden Path 步骤1+3「主理人调 GET .../health，传合法存在 id → 返回 200 + JSON：healthy/state/last_node/...」

**可观测行为**: HTTP 200，body 含 `initiative_id/healthy/state/last_node/retries/interrupts/stuck_minutes/reason` 全部 8 个键，类型正确

**验证命令**:
```bash
IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()")
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID','B_task_loop')"
NOW=$(date +%s)
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID','prep','running',1,$NOW)"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health")
psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='$IID'; DELETE FROM initiative_runs WHERE initiative_id='$IID'"
echo "$RESP" | jq -e '.healthy==true and .state=="healthy" and .last_node=="prep"' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: HTTP 200；新鲜 event(0m) → state=healthy
**可执行验证**: 见上（`curl -sf` 对未注册路由返 404→非0 退出→FAIL，杜绝假绿）

---

### Step 2: 系统读两表并按判定逻辑裁决（卡住场景）
**来源**: `[FROM_PRD]` — Golden Path 步骤2+4「读 initiative_runs + initiative_run_events，统计重试/打断/最近事件时间」「卡在 prep 反复重试 → state=stuck、stuck_minutes=N、retries=N、last_node=prep」

**可观测行为**: 对「prep 反复重试且最近活动 15 分钟前」的 run，返回 `state=stuck`、`last_node=prep`、`retries`/`interrupts` 反映 events、`stuck_minutes>=10`

**验证命令**:
```bash
IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()")
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID','B_task_loop')"
OLD=$(( $(date +%s) - 900 ))
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID','prep','failed',1,$((OLD-100))),('$IID','prep','failed',2,$((OLD-50))),('$IID','prep','running',3,$OLD)"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health")
psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='$IID'; DELETE FROM initiative_runs WHERE initiative_id='$IID'"
echo "$RESP" | jq -e '.state=="stuck" and .healthy==false and .last_node=="prep" and .retries==2 and .interrupts==2 and .stuck_minutes>=10' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: stuck_minutes≥10 且 <20 → stuck；retries=MAX(attempt)-1=2；interrupts=failed 条数=2
**可执行验证**: 见上

---

### Step 3: 终态 run 正确反映（failed / completed）
**来源**: `[FROM_PRD]` — Golden Path 步骤3「主理人一眼看出 已完成 / 已失败」+ E2E 验收点2「已 failed 的 run 返回 failed」

**可观测行为**: `phase='failed'` 的 run → `state='failed'`、`healthy=false`；`phase='done'` → `state='completed'`、`healthy=true`

**验证命令**:
```bash
IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()")
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID','failed')"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health")
psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='$IID'"
echo "$RESP" | jq -e '.state=="failed" and .healthy==false' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: phase=failed → state=failed, healthy=false
**可执行验证**: 见上

---

### Step 4: 异常路径 — 非法 UUID → 400，合法但不存在 → 404
**来源**: `[FROM_PRD]` — Golden Path 步骤5「非法 UUID → 400 带 error；合法但不存在的 id → 404 带 error」+ 边界「非法 UUID 不进 DB 查询」

**可观测行为**: `not-a-uuid` → HTTP 400 + `error` 字符串；合法但不存在 UUID → HTTP 404 + `error` 字符串

**验证命令**:
```bash
C400=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/not-a-uuid/health")
[ "$C400" = "400" ] || { echo "FAIL: 非法UUID应400 实际$C400"; exit 1; }
C404=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-4000-8000-000000000000/health")
[ "$C404" = "404" ] || { echo "FAIL: 不存在id应404 实际$C404"; exit 1; }
echo OK
```
**硬阈值**: 非法 UUID=400（不进 DB）；合法不存在=404
**可执行验证**: 见上

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e
DB="${DB:-postgresql://localhost/cecelia}"
FAILED=0

# ── 场景一：健康在跑（新鲜 event）→ state=healthy ──
IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()")
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$IID','B_task_loop')"
NOW=$(date +%s)
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID','prep','running',1,$NOW)"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health")
echo "$RESP" | jq -e 'keys == ["healthy","initiative_id","interrupts","last_node","reason","retries","state","stuck_minutes"]' \
  || { echo "FAIL: schema keys 不符 -> $RESP"; FAILED=1; }
echo "$RESP" | jq -e '.healthy==true and .state=="healthy" and .last_node=="prep" and .stuck_minutes<10' \
  || { echo "FAIL: 健康场景判定错 -> $RESP"; FAILED=1; }

# ── 场景二：卡在 prep 反复重试（最近活动 15 分钟前）→ state=stuck ──
OLD=$(( $(date +%s) - 900 ))
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID','prep','failed',2,$((OLD-50))),('$IID','prep','running',3,$OLD)"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health")
echo "$RESP" | jq -e '.state=="stuck" and .healthy==false and .last_node=="prep" and .retries==2 and .stuck_minutes>=10 and .stuck_minutes<20' \
  || { echo "FAIL: stuck 场景判定错 -> $RESP"; FAILED=1; }

# ── 场景二b：僵尸（最近活动 25 分钟前）→ state=zombie ──
DEAD=$(( $(date +%s) - 1500 ))
psql "$DB" -c "UPDATE initiative_run_events SET ts=$DEAD WHERE initiative_id='$IID'"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health")
echo "$RESP" | jq -e '.state=="zombie" and .healthy==false and .stuck_minutes>=20' \
  || { echo "FAIL: zombie 场景判定错 -> $RESP"; FAILED=1; }
psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='$IID'; DELETE FROM initiative_runs WHERE initiative_id='$IID'"

# ── 场景三：已失败 run → state=failed ──
FID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()")
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$FID','failed')"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$FID/health")
echo "$RESP" | jq -e '.state=="failed" and .healthy==false' || { echo "FAIL: failed 场景判定错 -> $RESP"; FAILED=1; }
psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='$FID'"

# ── 场景三b：已完成 run → state=completed ──
DID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()")
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id, phase) VALUES ('$DID','done')"
RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$DID/health")
echo "$RESP" | jq -e '.state=="completed" and .healthy==true' || { echo "FAIL: completed 场景判定错 -> $RESP"; FAILED=1; }
psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='$DID'"

# ── 异常：非法 UUID → 400；合法不存在 → 404 ──
C400=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/not-a-uuid/health")
[ "$C400" = "400" ] || { echo "FAIL: 非法UUID应400 实际$C400"; FAILED=1; }
C404=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-4000-8000-000000000000/health")
[ "$C404" = "404" ] || { echo "FAIL: 不存在id应404 实际$C404"; FAILED=1; }

[ "$FAILED" = "0" ] || { echo "❌ Golden Path E2E 存在失败项"; exit 1; }
echo "✅ Golden Path 健康端点 E2E 全部通过"
```

**通过标准**: 脚本 exit 0

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| /initiative/:id/health 健康裁决 | `tests/harness-initiative-health.test.ts` | healthy/stuck/zombie/completed/failed 五态 + 400/404 + retries/interrupts 计算 + schema keys | → 路由未实现，supertest 收到 404，全部 it 失败 |
