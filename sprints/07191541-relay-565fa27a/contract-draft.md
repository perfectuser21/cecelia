# Sprint Contract Draft — smoke-verify-headless-dispatch 565fa27a

> 生成日期：2026-07-19
> Task ID：565fa27a-4b5b-4eb7-905e-b6fb61eb8413
> Sprint Dir：sprints/07191541-relay-565fa27a
> Brain URL：http://localhost:5221（可由 BRAIN_URL env 覆盖）
> 模式：headless / executor=claude / orchestrator=skill-relay

---

## Response Schema（推导来源: PRD 字面 + 当前 Brain API headless payload）

本 sprint 不新增 HTTP endpoint；验收复用现有 Brain task API 与 PostgreSQL `tasks`/`initiative_runs` 定点读。
成功证据必须重绑定当前 task `565fa27a-4b5b-4eb7-905e-b6fb61eb8413`。

### Endpoint: GET /api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413

**Success (HTTP 200)**:
```json
{
  "id": "565fa27a-4b5b-4eb7-905e-b6fb61eb8413",
  "task_type": "harness_initiative",
  "status": "in_progress",
  "payload": {
    "mode": "headless",
    "executor": "claude",
    "orchestrator": "skill-relay",
    "smoke_test": true,
    "dispatched_by_orchestrator": true
  }
}
```

- `id` (string, 必填): PRD FR-001 字面当前 task id。
- `task_type` (string, 必填): PRD Golden Path 要求 Brain 作为 `harness_initiative` 处理。
- `status` (string, 必填): PRD FR-002 headless dispatch oracle；必须为 `in_progress`。
- `payload.mode` (string, 必填): PRD 字面值 `headless`。
- `payload.executor` (string, 必填): PRD 字面值 `claude`。
- `payload.orchestrator` (string, 必填): PRD 字面值 `skill-relay`。
- `payload.smoke_test` (bool, 必填): PRD 字面值 `true`。
- `payload.dispatched_by_orchestrator` (bool, 必填): PRD FR-002 dispatch oracle。
- **headless 不检查**: `executor_kind`（headless 无需 headed-session）、`claimed_by`（headless 认领方式不同）、`journey_id`（当前任务无 journey_id）。
- **禁用字段名**: `token`, `github_token`, `anthropic_token`, `thin_prd`, `prep_prd_body`。

**Error (HTTP 404)**:
```json
{"error": "Task not found", "id": "<task_id>"}
```

### Endpoint: GET /api/brain/harness/runs?limit=50

**Success (HTTP 200)**:
```json
[
  {
    "id": "<run_uuid>",
    "initiative_id": "<task_uuid>",
    "phase": "A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress|failed",
    "started_at": "<timestamp>",
    "completed_at": "<timestamp|null>",
    "failure_reason": "<string|null>"
  }
]
```

- `initiative_id` (string): 必须等于当前 task id 才能作为当前 run 证据。
- `phase` (string): 若当前 task run 存在，必须非 `failed` 且属于已知 phase 集合。
- 缺失当前 task run → 只输出 CONCERN，不能判定 headless smoke 成功。

**DB oracle（psql tasks 表）**:
```
tasks.id:                        565fa27a-4b5b-4eb7-905e-b6fb61eb8413
tasks.status:                    in_progress
tasks.task_type:                 harness_initiative
tasks.payload->>'mode':          headless
tasks.payload->>'executor':      claude
tasks.payload->>'orchestrator':  skill-relay
tasks.payload->>'dispatched_by_orchestrator': true

注意: 不检查 executor_kind, claimed_by, claimed_at, journey_id（headless 任务无需）
```

---

## 已知约束

- [api_registry] `GET /api/brain/tasks/:id` 返回 `SELECT * FROM tasks WHERE id=$1`，404 schema 为 `{error,id}`。
- [api_registry] `GET /api/brain/harness/runs` 返回最近 `initiative_runs` 列表。
- [db_schema] `tasks.id/status/payload/task_type` 与 `initiative_runs.initiative_id/phase/started_at/failure_reason` 已确认存在。
- [headless 差异] 本 task 无 `journey_id`、无 `executor_kind`、无 `claimed_by`，与 headed 版本（d355821f）严格区分。
- [PRD 事实] 当前 task `565fa27a` 的 payload 三元组：`mode=headless`、`executor=claude`、`orchestrator=skill-relay`、`smoke_test=true`、`dispatched_by_orchestrator=true`。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|---------|
| **FR（做什么）** | 功能需求 | 覆盖 PRD FR-001..FR-005：当前 task payload/status 验证；headless dispatch oracle；initiative_runs 缺失 concern 处理；当前 sprint 证据边界；日志脱敏。 |
| **NFR（做得多好）** | 非功能需求 | local_api 只读验收；不重复 spawn；Brain API/DB 读失败即 FAIL；证据输出脱敏。 |
| **Invariant（永不违反）** | 不变量 | 覆盖 PRD 7 条 Invariant：单 slot 串行、禁写死环境、真验才 done、凭据安全、日志脱敏、端点鉴权 N/A、租户隔离 N/A。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方判定点登记表。 |
| **保质期（何时过期）** | 失效条件 | 本合同锚定一次性 task id；当 Brain task API、`tasks` schema 或 headless dispatch 语义变更时过期。 |
| **死亡告警（停了谁知道）** | 停止告警机制 | Evaluator/Controller 执行 `e2e-verify.sh` 或 DoD `manual:bash` 非 0 即知道；本 sprint 不新增常驻告警。 |
| **失败语义（挂了怎么办）** | 故障处理 | Brain API/DB 不可读、payload 不符、task failed、run failed/unknown 均拦截；run 缺失只输出 concern。 |
| **效果确认（已发≠已生效）** | 生效确认 | 以当前 task API + DB `tasks` 定点读作为生效 oracle；run 缺失时登记 concern，不声明 done。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 当前 task 是否为 headless dispatch oracle | A. 只看 API；B. API + DB 双重；C. 任一缺失即 FAIL | B. API + DB 双重（psql 真验） | PRD [真验才done] invariant；headless 认领无 headed-session claim，但仍需 DB 确认 status/payload | API 正常但 DB 写入异常时假通过 |
| initiative_runs 缺失时判断 | A. 缺失=成功；B. 缺失=FAIL；C. 缺失=CONCERN（先通过 dispatch oracle）| C. CONCERN 路径 | PRD FR-003 明确要求；headless relay run 可能延迟写入 | 缺失被误判为成功，污染验收结论 |
| 历史 task d355821f 是否可作证据 | A. 可用；B. 严格拒绝 | B. 严格拒绝 | PRD 明确本次 smoke 只接受 565fa27a 证据 | 历史 headed/codex 成功被误当 headless/claude 成功 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain task API 不可达或非 200 | exit 1，输出 `FAIL: brain task api` | 是，只读重跑 | 无降级 |
| task payload/status 与 PRD 不符 | exit 1，列出不匹配字段 | 是，只读重跑 | 无降级 |
| DB `tasks` 当前行缺失或字段不符 | exit 1 | 是，只读重跑 | 无降级 |
| `initiative_runs` 当前行存在但 failed/unknown phase | exit 1 | 是，只读重跑 | 无降级 |
| `initiative_runs` 当前行缺失 | 输出 `CONCERN`；必须先通过 task API + DB dispatch oracle | 是，只读重跑 | headless dispatch concern，不标 run 成功 |
| 证据文件含 secret 或历史 task 证据冒充当前证据 | exit 1 | 是，只读重跑 | 无降级 |

---

## 真实调用方请求 shape

```json
{
  "method": "GET",
  "path": "/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413",
  "auth": "local Brain API context; no new endpoint is introduced",
  "expected_payload": {
    "mode": "headless",
    "executor": "claude",
    "orchestrator": "skill-relay",
    "smoke_test": true,
    "dispatched_by_orchestrator": true
  }
}
```

---

## 接缝清单

- Brain task API ↔ `tasks` 表：当前 task 的 API 响应与 DB `tasks.id` 必须同一个 task id，payload/status 字段一致。
- Headless dispatch oracle ↔ status：`status=in_progress` + `dispatched_by_orchestrator=true` 必须从当前 task API + DB 真读。
- Harness runs API ↔ `initiative_runs` 表：若当前 task run 存在，必须真读 DB phase；run 缺失只能登记 concern。
- Sprint evidence ↔ 文件系统：证据路径只能在 `sprints/07191541-relay-565fa27a/`，日志需脱敏。

---

## 禁 mock 边清单

- Brain task API ↔ `tasks` 表：测试必须真实 `curl -sf` + 真实 `psql`，禁止 mock API 响应或 fixture JSON。
- Headless dispatch oracle：必须真读当前 DB 行，禁止手工设置 status 变量冒充。
- Harness runs ↔ `initiative_runs` 表：缺失时必须输出 concern；禁止插入假 run 或把历史 run（d355821f）当当前证据。
- `e2e-verify.sh` ↔ shell exit code：DoD 必须真执行脚本并传播非 0 exit，禁止 mock/stub/`|| true`/无条件 `exit 0`。

---

## L3 真目标复核

- [BEHAVIOR] verification_level: L3 真目标复核：headless-smoke 的 done 只能由真实 Brain API 与 PostgreSQL `tasks`/`initiative_runs` 给出，不接受 mock/stub/fixture、静态日志替代、吞错或无条件 exit 0。
  verification_level: L3
  Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"; TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; [ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }; grep -F "curl -sf" "$VERIFY" >/dev/null || { echo "FAIL: missing real curl"; exit 1; }; grep -F "psql" "$VERIFY" >/dev/null || { echo "FAIL: missing real psql"; exit 1; }; ! grep -E "MOCK_|force_|\|\|[[:space:]]*true|exit[[:space:]]+0[[:space:]]*(#.*)?$" "$VERIFY" >/dev/null || { echo "FAIL: wrapper contains mock/stub/swallow/exit0"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY"'

---

## Golden Path

独立小路（无父路）

Brain 当前 task `565fa27a-4b5b-4eb7-905e-b6fb61eb8413` → generator 使用永久 wrapper `scripts/smoke/e2e/relay-565fa27a.sh` → 脚本定点读取 Brain task API → 脚本定点读取 DB `tasks` dispatch oracle → 脚本读取 harness runs/DB `initiative_runs`，接受当前 task run 或在 run 缺失时输出 concern → 脚本扫描当前 sprint 证据边界与脱敏 → exit code 成为 headless claude skill-relay smoke oracle。

### Step 1: 当前 task payload shape 被 Brain API 真实返回

**来源**: `[FROM_PRD]` — PRD FR-001 要求 task API 返回当前 task，payload 字面包含 `mode=headless`、`executor=claude`、`orchestrator=skill-relay`、`smoke_test=true`、`dispatched_by_orchestrator=true`。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e --arg tid "$TASK_ID" '.id == $tid'
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e '.payload.mode == "headless" and .payload.executor == "claude" and .payload.orchestrator == "skill-relay" and .payload.smoke_test == true and .payload.dispatched_by_orchestrator == true'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not) and (.payload | has("prep_prd_body") | not)'
```

**硬阈值**: HTTP 200；`id/task_type/payload` 完全匹配当前 task；禁用字段不存在。

### Step 2: DB `tasks` 记录显示当前 task headless dispatch oracle

**来源**: `[FROM_PRD]` — PRD FR-002 要求读取 `status=in_progress`、payload 三元组与 `dispatched_by_orchestrator=true`。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
ROW=$(psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT status, task_type, payload->>'mode', payload->>'executor', payload->>'orchestrator', COALESCE(payload->>'dispatched_by_orchestrator','') FROM tasks WHERE id = \$\$${TASK_ID}\$\$::uuid")
[ -n "$ROW" ] || { echo "FAIL: tasks row missing"; exit 1; }
IFS='|' read -r STATUS TASK_TYPE MODE EXECUTOR ORCH DISPATCHED_BY <<< "$ROW"
[ "$STATUS" = "in_progress" ] || { echo "FAIL: status=$STATUS"; exit 1; }
[ "$TASK_TYPE" = "harness_initiative" ] || { echo "FAIL: task_type=$TASK_TYPE"; exit 1; }
[ "$MODE" = "headless" ] && [ "$EXECUTOR" = "claude" ] && [ "$ORCH" = "skill-relay" ] || { echo "FAIL: payload mismatch"; exit 1; }
[ "$DISPATCHED_BY" = "true" ] || { echo "FAIL: dispatched_by_orchestrator=$DISPATCHED_BY"; exit 1; }
```

**硬阈值**: 当前 DB 行存在；`status=in_progress`；payload 三元组匹配；`dispatched_by_orchestrator=true`。

### Step 3: `initiative_runs` 缺失时输出 concern，不判定成功

**来源**: `[FROM_PRD]` — PRD FR-003 要求当前 task run 缺失时只能记录 concern。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
RUNS=$(curl -sf "$BRAIN_URL/api/brain/harness/runs?limit=50")
RUN_API_COUNT=$(echo "$RUNS" | jq --arg tid "$TASK_ID" '[.[]? | select(.initiative_id == $tid)] | length')
RUN_ROW=$(psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$::uuid ORDER BY started_at DESC LIMIT 1")
if [ -z "$RUN_ROW" ]; then
  echo "CONCERN: initiative_runs missing for current task; runs_api_count=$RUN_API_COUNT"
else
  IFS='|' read -r RUN_HOST RUN_PHASE RUN_STARTED_AT RUN_FAILURE_REASON <<< "$RUN_ROW"
  [ "$RUN_PHASE" != "failed" ] || { echo "FAIL: run failed reason=$RUN_FAILURE_REASON"; exit 1; }
  case "$RUN_PHASE" in A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;; *) echo "FAIL: run phase=$RUN_PHASE"; exit 1 ;; esac
fi
```

**硬阈值**: run 存在时 phase 必须合法且非 failed；run 缺失时只输出 concern（不 exit 1）。

### Step 4: 当前 sprint 证据边界与脱敏规则生效

**来源**: `[FROM_PRD]` — PRD FR-004/FR-005 要求证据只落当前 sprint，日志不得含 secrets。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"
[ "$TASK_ID" = "565fa27a-4b5b-4eb7-905e-b6fb61eb8413" ] || { echo "FAIL: TASK_ID not rebound to current task"; exit 1; }
for path in "$SPRINT_DIR/tui.log" "$SPRINT_DIR/harness-report.md"; do
  if [ -f "$path" ]; then
    if grep -E 'ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|xox[abp]-|BEGIN [A-Z ]*PRIVATE KEY|Authorization: Bearer' "$path" >/dev/null; then
      echo "FAIL: sensitive token-like content in $path"
      exit 1
    fi
  fi
done
```

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
# E2E 验收命令（manual:bash）— 当前 task 565fa27a headless dispatch smoke
set -euo pipefail
SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"
TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"

[ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }
TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DATABASE_URL" SPRINT_DIR="$SPRINT_DIR" bash "$VERIFY"
```

**执行入口（manual:bash）**:
```bash
bash scripts/smoke/e2e/relay-565fa27a.sh
```

或通过 DoD 覆盖 env：
```bash
BRAIN_URL=http://localhost:5221 DATABASE_URL=postgresql://cecelia:cecelia@localhost:5432/cecelia SPRINT_DIR=sprints/07191541-relay-565fa27a bash scripts/smoke/e2e/relay-565fa27a.sh
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| task API payload shape | `../../tests/regression/relay-565fa27a/contract-red.test.sh` | B1: e2e-verify.sh 校验当前 task API payload shape | wrapper 不存在或 payload 不符时 FAIL |
| DB dispatch oracle | `../../tests/regression/relay-565fa27a/contract-red.test.sh` | B2: e2e-verify.sh 校验 status=in_progress + dispatched_by_orchestrator=true | DB 行缺失或字段不符时 FAIL |
| initiative_runs concern 路径 | `../../tests/regression/relay-565fa27a/contract-red.test.sh` | B3: initiative_runs 缺 run 时只输出 concern | run 缺失被误判为成功时 FAIL |
| 历史 task 拒绝 | `../../tests/regression/relay-565fa27a/contract-red.test.sh` | B4: 拒绝历史 task d355821f 作为当前证据 | TASK_ID 或 SPRINT_DIR 绑历史任务时 FAIL |
| 证据边界与脱敏 | `../../tests/regression/relay-565fa27a/contract-red.test.sh` | B5: 证据只在当前 sprint，日志脱敏 | SPRINT_DIR 偏离或日志含 secret 时 FAIL |
| L3 真目标复核 | `../../tests/regression/relay-565fa27a/contract-red.test.sh` | B6: wrapper 真实 curl/psql，禁止 mock/stub/exit0 | wrapper 含 mock/stub/无条件 exit0 时 FAIL |

---

## 未覆盖真实链路清单

| 链路 | 状态 | 说明 |
|------|------|------|
| initiative_runs headless relay run | CONCERN（非 mock 豁免） | `initiative_runs` 目前未返回当前 task run；不可声明 headless relay 成功完成（FR-003）。 |
| journey_id 验证 | N/A | 当前 task 无 journey_id，明确排除检查。 |
| executor_kind 验证 | N/A | headless 任务不使用 headed-session，明确排除。 |
| claimed_by 验证 | N/A | headless 认领方式不同，不检查 claimed_by。 |
| UI/Dashboard 验证 | N/A | 本 sprint 不包含 UI/Dashboard 改动。 |
| Brain runtime 变更 | N/A | 本 sprint 不改 Brain runtime。 |
