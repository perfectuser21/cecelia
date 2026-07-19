# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面 + api_registry推导 + 当前 Brain API 实测）

本 sprint 不新增 HTTP endpoint；验收复用现有 Brain task API、harness runs API 与 PostgreSQL `tasks`/`initiative_runs` 定点读。成功证据必须重绑定当前 task `d355821f-4a37-4fa2-ad2f-99668bc91a3d`。

### Endpoint: GET /api/brain/tasks/d355821f-4a37-4fa2-ad2f-99668bc91a3d

**Success (HTTP 200)**:
```json
{
  "id": "d355821f-4a37-4fa2-ad2f-99668bc91a3d",
  "task_type": "harness_initiative",
  "status": "in_progress",
  "payload": {
    "mode": "headed",
    "executor": "codex",
    "orchestrator": "skill-relay",
    "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963",
    "dispatched_by_orchestrator": true
  },
  "claimed_by": "session:engine-patch",
  "claimed_at": "<timestamp>",
  "executor_kind": "headed-session"
}
```

- `id` (string, 必填): PRD FR-001 字面当前 task id。
- `task_type` (string, 必填): PRD Golden Path 要求 Brain 作为 `harness_initiative` 处理。
- `status` (string, 必填): PRD FR-002 当前 foreground takeover/claim oracle。
- `payload.mode` (string, 必填): PRD 字面值 `headed`。
- `payload.executor` (string, 必填): PRD 字面值 `codex`。
- `payload.orchestrator` (string, 必填): PRD 字面值 `skill-relay`。
- `payload.journey_id` (string, 必填): PRD 字面值 `bb8cc561-b3ee-4fec-b74d-2255694bd963`。
- `claimed_by` / `claimed_at` (string/timestamp, 必填): PRD FR-002 claim oracle。
- `executor_kind` (string, 必填): PRD 当前可观测 headed session 证据。
- **禁用字段名**: `token`, `github_token`, `anthropic_token`, `openai_api_key`, `codex_token`, `thin_prd`, `prep_prd_body`, `sprint_dir`, `prd_content`。

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
    "journey_type": "autonomous",
    "started_at": "<timestamp>",
    "completed_at": "<timestamp|null>",
    "failure_reason": "<string|null>"
  }
]
```

- `initiative_id` (string, 必填): 必须等于当前 task id 才能作为当前 run 证据。
- `phase` (string, 必填): 若当前 task run 存在，必须非 `failed` 且属于已知 phase 集合。
- `failure_reason` (string|null): run failed 时必须导致 FAIL，不能被 concern 吞掉。

**DB oracle**:
```json
{
  "tasks": {
    "id": "d355821f-4a37-4fa2-ad2f-99668bc91a3d",
    "status": "in_progress",
    "task_type": "harness_initiative",
    "claimed_by": "session:engine-patch",
    "claimed_at": "<timestamp>",
    "executor_kind": "headed-session"
  },
  "initiative_runs": {
    "initiative_id": "d355821f-4a37-4fa2-ad2f-99668bc91a3d",
    "orchestrator_host": "skill-relay-codex-headed",
    "phase": "<non-failed phase>"
  }
}
```

`initiative_runs` 对当前 task 不得作为缺失即成功的捷径：run 缺失只能输出 concern，并且必须先通过当前 task API + DB `tasks` claim oracle 才能走 foreground takeover 分支。

## 已知约束（来自回归测试 / registry / 当前实测）

- [api_registry] `packages/brain/src/routes/task-tasks.js:237` 的 `GET /:id` 返回 `SELECT * FROM tasks WHERE id=$1`，404 schema 为 `{error,id}`。
- [api_registry] `packages/brain/src/routes/harness.js:77` 的 `GET /runs` 返回最近 `initiative_runs` 列表，不含 `orchestrator_host`，host 必须走 DB oracle。
- [db_schema] 本机 `information_schema` 已确认 `tasks.id/status/payload/task_type/claimed_by/claimed_at/executor_kind` 与 `initiative_runs.initiative_id/orchestrator_host/phase/started_at/completed_at/failure_reason/journey_id` 存在。
- [test_registry] `tests/regression/relay-a85e0582/headed-smoke-contract.test.ts` 覆盖 codex headed payload 三元组、secret 禁用字段、`initiative_runs` phase 拒绝 failed/unknown。
- [test_registry] `tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts` 覆盖 headed relay run 或 foreground 分支、local_api wrapper 不使用 mock/吞错。
- [context-manifest] `GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 当前 HTTP 404，累积 FR 以 PRD `## 累积 FR` 为准。
- [PRD事实] PRD/PrepPRD 记录当前 task `d355821f-4a37-4fa2-ad2f-99668bc91a3d` 的目标 claim oracle 为 `status=in_progress`、`claimed_by=session:engine-patch`、`claimed_at=2026-07-19T05:16:22.702Z`、`executor_kind=headed-session`。
- [起草期二次实测] Brain API/DB 随后显示当前 task 已漂到 `status=queued`、`claimed_by/claimed_at=null`，payload 出现 `orphan_requeue_count=1`；合同将该状态视为 claim oracle 未满足，不能作为 headed relay 成功。
- [当前实测] 当前 task 无 `initiative_runs` 行，`/api/brain/harness/runs?limit=50` 与 journey golden-paths 未提供可归因到当前 task 的 run 证据；这是 concern，不是成功证据。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 覆盖 PRD FR-001..FR-005：当前 task payload/status、foreground takeover/claim oracle、缺 run concern、当前 sprint 证据边界、日志脱敏。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | local_api 只读验收；不重复 spawn；不抢占或误杀已有 headed session；Brain API/DB 读失败即 FAIL；证据输出脱敏。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 覆盖 PRD 7 条 Invariant：单 slot 串行、禁写死环境、真验才 done、凭据安全、日志脱敏、端点鉴权 N/A、租户隔离 N/A。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本合同锚定一次性 task id；当 Brain task API、`tasks` claim 字段、`initiative_runs` schema 或 foreground takeover 语义变更时过期。 |
| **死亡告警（停了谁知道）** | 功能停止工作后谁知道 | Evaluator/Controller 执行 `e2e-verify.sh` 或 DoD `manual:bash` 非 0 即知道；本 sprint 不新增常驻告警。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | Brain API/DB 不可读、payload/claim 不符、task failed、run failed 均拦截；run 缺失只在 API+DB claim oracle 通过后输出 concern。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 本 sprint 无对外发布；以当前 task API + DB `tasks` claim 定点读作为生效 oracle；run/golden-path 缺失登记 concern。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 当前 task 是否可判定为 codex headed relay foreground takeover | A. 强制要求 `initiative_runs` 当前行存在；B. run 缺失时要求 Brain task API + DB `tasks` claim oracle 同时成立并输出 concern | B. foreground takeover oracle | PRD 明确禁止把 `initiative_runs` 缺失当成功，也禁止把缺失当唯一失败；成功必须基于当前 task API + DB claim oracle | 未认领 task 可能假通过，或真实 foreground takeover 被误判失败 |
| 当前证据是否属于本 task 而非历史同名 task | A. 查询最近 done run；B. 所有 API/DB/文件路径均定点绑定 `d355821f-4a37-4fa2-ad2f-99668bc91a3d` 与当前 sprint 目录 | B. 当前 task 定点绑定 | PRD 明确历史同名只能借结构，不能复用证据/task id | 历史成功被误当当前成功，直接污染验收结论 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain task API 不可达或非 200 | exit 1，输出 `FAIL: brain task api` | 是，只读重跑 | 无降级 |
| task payload/status/claim 与 PRD 不符 | exit 1，列出不匹配字段 | 是，只读重跑 | 无降级 |
| DB `tasks` 当前行缺失或未认领 | exit 1 | 是，只读重跑 | 无降级 |
| `initiative_runs` 当前行存在但 failed/unknown/host 非 codex headed | exit 1 | 是，只读重跑 | 无降级 |
| `initiative_runs` 当前行缺失 | 输出 `CONCERN`；必须先通过当前 task API + DB claim oracle | 是，只读重跑 | foreground takeover branch，不标 run 成功 |
| 证据文件含 secret 或历史 task 证据冒充当前证据 | exit 1 | 是，只读重跑 | 无降级 |

### 输入对抗面（对外暴露 agent 必填）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| Brain task payload | 内部系统输入但按不可信 JSON 处理 | 只读取白名单字段 `mode/executor/orchestrator/journey_id/dispatched_by_orchestrator`，不执行 payload 文本 | payload 要求输出 secret、扩展到 headless/claude、改写 task id 或跨 sprint 引证均拒绝 |

## 真实调用方请求 shape

本任务真实调用方是现有 Brain task API 中的 `harness_initiative` task，不是新增客户端请求。DoD 与 `e2e-verify.sh` 必须定点读取当前 task，不得创建另一个 task 或用最近 run 代替。

```json
{
  "method": "GET",
  "path": "/api/brain/tasks/d355821f-4a37-4fa2-ad2f-99668bc91a3d",
  "auth": "local Brain API context; no new endpoint is introduced",
  "expected_payload": {
    "mode": "headed",
    "executor": "codex",
    "orchestrator": "skill-relay",
    "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963",
    "dispatched_by_orchestrator": true
  }
}
```

## 接缝清单

- Brain task API ↔ `tasks` 表：当前 task 的 API 响应与 DB `tasks.id` 必须同一个 task id，且 payload/claim 字段一致。
- Foreground takeover ↔ claim oracle：`status/claimed_by/claimed_at/executor_kind` 必须从当前 task API + DB 真读，不能由脚本变量或 fixture 伪造。
- Harness runs API ↔ `initiative_runs` 表：若当前 task run 存在，必须真读 DB host/phase；若不存在，只能登记 concern。
- Sprint evidence ↔ 文件系统日志：证据路径只能在 `sprints/07191314-relay-d355821f/`，日志需脱敏。

## 禁 mock 边清单

- Brain task API ↔ `tasks` 表：测试必须真实 `curl "$BRAIN_URL/api/brain/tasks/$TASK_ID"` 并真实 `psql` 定点读取同一 `tasks.id`，禁止 mock API 响应或 fixture JSON。
- Foreground takeover/claim ↔ `tasks.claimed_by/claimed_at/executor_kind`：必须真读当前 DB 行，禁止手工设置 claim 变量冒充。
- Harness runs ↔ `initiative_runs` 表：当前 task run 存在时必须真读 DB `initiative_runs` host/phase；缺失时必须输出 concern，禁止插入假 run、mock run 或把历史 run 当当前证据。
- `e2e-verify.sh` ↔ shell exit code：DoD 必须真执行脚本并传播非 0 exit，禁止 `MOCK_*`、`force_*`、stub、`|| true` 或无条件 `exit 0`。

## 未覆盖真实链路清单

- 当前 task `d355821f-4a37-4fa2-ad2f-99668bc91a3d` 的 `initiative_runs` 当前行未覆盖：本机 DB 查询无行，`/api/brain/harness/runs?limit=50` 和 journey golden-paths 未提供可归因到当前 task 的 run 证据；验收必须将其作为 concern/foreground takeover 分支，不能作为 headed relay 成功证据。

## Golden Path

独立小路（无父路）

Brain 当前 task `d355821f-4a37-4fa2-ad2f-99668bc91a3d` → generator 使用永久 wrapper `scripts/smoke/e2e/relay-d355821f.sh` → 脚本定点读取 Brain task API → 脚本定点读取 DB `tasks` claim oracle → 脚本读取 harness runs/DB `initiative_runs` 并在缺失时输出 concern → 脚本扫描当前 sprint 证据边界与脱敏 → exit code 成为 codex headed skill-relay smoke oracle。

### Step 1: 当前 task payload shape 被 Brain API 真实返回

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点与 FR-001 要求 task API 返回当前 task，payload 字面包含 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`、`journey_id`。

**可观测行为**: `GET /api/brain/tasks/<TASK_ID>` 返回当前 task，payload 字段逐字匹配，且 payload 不含 secret/历史 PRD 字段。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e --arg tid "$TASK_ID" '.id == $tid'
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == "skill-relay" and .payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("openai_api_key") | not) and (.payload | has("codex_token") | not) and (.payload | has("thin_prd") | not) and (.payload | has("prep_prd_body") | not) and (.payload | has("sprint_dir") | not) and (.payload | has("prd_content") | not)'
```

**硬阈值**: HTTP 200；`id/task_type/payload` 完全匹配当前 task；禁用字段不存在。

### Step 2: DB `tasks` 记录显示当前 task 已被 headed foreground session 认领

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2/3 点与 FR-002 要求读取 `status`、`claimed_by`、`claimed_at`、`executor_kind`。

**可观测行为**: DB `tasks` 当前行处于 `in_progress`，payload 三元组匹配，`claimed_by=session:engine-patch`、`claimed_at` 非空，`executor_kind=headed-session`。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
ROW=$(psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT status, task_type, payload->>'mode', payload->>'executor', payload->>'orchestrator', payload->>'journey_id', COALESCE(claimed_by,''), COALESCE(claimed_at::text,''), COALESCE(executor_kind,'') FROM tasks WHERE id = \$\$${TASK_ID}\$\$::uuid")
[ -n "$ROW" ] || { echo "FAIL: tasks row missing"; exit 1; }
IFS='|' read -r STATUS TASK_TYPE MODE EXECUTOR ORCH JOURNEY_ID CLAIMED_BY CLAIMED_AT EXECUTOR_KIND <<< "$ROW"
[ "$STATUS" = "in_progress" ] || { echo "FAIL: status=$STATUS"; exit 1; }
[ "$TASK_TYPE" = "harness_initiative" ] || { echo "FAIL: task_type=$TASK_TYPE"; exit 1; }
[ "$MODE" = "headed" ] && [ "$EXECUTOR" = "codex" ] && [ "$ORCH" = "skill-relay" ] || { echo "FAIL: payload mismatch"; exit 1; }
[ "$JOURNEY_ID" = "bb8cc561-b3ee-4fec-b74d-2255694bd963" ] || { echo "FAIL: journey_id=$JOURNEY_ID"; exit 1; }
[ "$CLAIMED_BY" = "session:engine-patch" ] && [ -n "$CLAIMED_AT" ] || { echo "FAIL: claim missing"; exit 1; }
[ "$EXECUTOR_KIND" = "headed-session" ] || { echo "FAIL: executor_kind=$EXECUTOR_KIND"; exit 1; }
```

**硬阈值**: 当前 DB 行存在；`status=in_progress`；payload 三元组与 journey_id 匹配；claim/executor_kind 匹配。

### Step 3: `initiative_runs` 存在则真验 host/phase，缺失只作为 concern

**来源**: `[FROM_PRD]` — PRD FR-003 与用户约束要求 `/api/brain/harness/runs` 或 DB 未提供当前 task run 时不得判定 headed relay 已成功完成。

**可观测行为**: 若当前 task run 存在，host/phase 必须为 codex headed 且非 failed；若不存在，脚本必须先完成 Step 1/2，再输出 `CONCERN` 并走 foreground takeover 分支。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"
JOURNEY_ID="${JOURNEY_ID:-bb8cc561-b3ee-4fec-b74d-2255694bd963}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
RUNS=$(curl -sf "$BRAIN_URL/api/brain/harness/runs?limit=50")
RUN_API_COUNT=$(echo "$RUNS" | jq --arg tid "$TASK_ID" '[.[]? | select(.initiative_id == $tid)] | length')
GPS=$(curl -sf "$BRAIN_URL/api/brain/journeys/$JOURNEY_ID/golden-paths")
GP_CURRENT_REFS=$(echo "$GPS" | jq --arg tid "$TASK_ID" '[.. | strings | select(. == $tid)] | length')
RUN_ROW=$(psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$::uuid ORDER BY started_at DESC LIMIT 1")
if [ -z "$RUN_ROW" ]; then
  echo "CONCERN: initiative_runs missing for current task; runs_api_count=$RUN_API_COUNT golden_path_refs=$GP_CURRENT_REFS; foreground takeover oracle required"
else
  IFS='|' read -r RUN_HOST RUN_PHASE RUN_STARTED_AT RUN_FAILURE_REASON <<< "$RUN_ROW"
  case "$RUN_HOST" in *skill-relay*codex*headed*|*codex*headed*) ;; *) echo "FAIL: run host=$RUN_HOST"; exit 1 ;; esac
  [ "$RUN_PHASE" != "failed" ] || { echo "FAIL: run failed reason=$RUN_FAILURE_REASON"; exit 1; }
  case "$RUN_PHASE" in A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;; *) echo "FAIL: run phase=$RUN_PHASE"; exit 1 ;; esac
  [ -n "$RUN_STARTED_AT" ] || { echo "FAIL: run started_at missing"; exit 1; }
fi
```

**硬阈值**: run 存在时 host/phase 合法且非 failed；run 缺失时只输出 concern，并不得跳过 Step 1/2 当前 task API + DB claim oracle。

### Step 4: 当前 sprint 证据边界与脱敏规则生效

**来源**: `[FROM_PRD]` — PRD FR-004/FR-005 要求证据只落当前 sprint，历史同名只借结构，日志不得含 secrets/完整敏感 prompt/客户隐私。

**可观测行为**: `SPRINT_DIR` 指向 `sprints/07191314-relay-d355821f`；日志存在时无 token 形态；脚本拒绝历史 task id 作为当前 `TASK_ID`。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"
[ "$TASK_ID" = "d355821f-4a37-4fa2-ad2f-99668bc91a3d" ] || { echo "FAIL: TASK_ID not rebound to current task"; exit 1; }
case "$SPRINT_DIR" in sprints/07191314-relay-d355821f|*/sprints/07191314-relay-d355821f) ;; *) echo "FAIL: bad SPRINT_DIR=$SPRINT_DIR"; exit 1 ;; esac
for path in "$SPRINT_DIR/tui.log" "$SPRINT_DIR/harness-report.md"; do
  if [ -f "$path" ]; then
    if grep -E 'ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|xox[abp]-|BEGIN [A-Z ]*PRIVATE KEY|Authorization: Bearer' "$path" >/dev/null; then
      echo "FAIL: sensitive token-like content in $path"
      exit 1
    fi
  fi
done
```

**硬阈值**: `TASK_ID` 与 `SPRINT_DIR` 必须是当前值；日志有 secret-like 内容即 FAIL。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/07191314-relay-d355821f}"
TASK_ID="${TASK_ID:-d355821f-4a37-4fa2-ad2f-99668bc91a3d}"
JOURNEY_ID="${JOURNEY_ID:-bb8cc561-b3ee-4fec-b74d-2255694bd963}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

load_task_api() {
  TASK_RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID") || fail "brain task api"
}

assert_current_task_only() {
  [ "$TASK_ID" = "d355821f-4a37-4fa2-ad2f-99668bc91a3d" ] || fail "TASK_ID not current: $TASK_ID"
  case "$SPRINT_DIR" in
    sprints/07191314-relay-d355821f|*/sprints/07191314-relay-d355821f) ;;
    *) fail "SPRINT_DIR not current: $SPRINT_DIR" ;;
  esac
  OLD_SHORT="$(printf '%s%s' 537 10094)"
  case "$TASK_ID:$SPRINT_DIR" in
    *"$OLD_SHORT"*) fail "historical task/sprint cannot be current evidence" ;;
  esac
  echo "OK: current task binding"
}

assert_task_payload_shape() {
  load_task_api
  echo "$TASK_RESP" | jq -e --arg tid "$TASK_ID" '.id == $tid' >/dev/null || fail "id mismatch"
  echo "$TASK_RESP" | jq -e '.task_type == "harness_initiative"' >/dev/null || fail "task_type mismatch"
  echo "$TASK_RESP" | jq -e '.status == "in_progress"' >/dev/null || fail "status not in_progress"
  echo "$TASK_RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == "skill-relay" and .payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963" and .payload.dispatched_by_orchestrator == true' >/dev/null || fail "payload shape mismatch"
  echo "$TASK_RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("openai_api_key") | not) and (.payload | has("codex_token") | not) and (.payload | has("thin_prd") | not) and (.payload | has("prep_prd_body") | not) and (.payload | has("sprint_dir") | not) and (.payload | has("prd_content") | not)' >/dev/null || fail "payload contains forbidden field"
  echo "OK: task api payload shape"
}

assert_db_claim_oracle() {
  TASK_ROW=$(psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT status, task_type, payload->>'mode', payload->>'executor', payload->>'orchestrator', payload->>'journey_id', COALESCE(claimed_by,''), COALESCE(claimed_at::text,''), COALESCE(executor_kind,'') FROM tasks WHERE id = \$\$${TASK_ID}\$\$::uuid")
  [ -n "$TASK_ROW" ] || fail "tasks row missing"
  IFS='|' read -r STATUS TASK_TYPE MODE EXECUTOR ORCH DB_JOURNEY_ID CLAIMED_BY CLAIMED_AT EXECUTOR_KIND <<< "$TASK_ROW"
  [ "$STATUS" = "in_progress" ] || fail "db status=$STATUS"
  [ "$TASK_TYPE" = "harness_initiative" ] || fail "db task_type=$TASK_TYPE"
  [ "$MODE" = "headed" ] && [ "$EXECUTOR" = "codex" ] && [ "$ORCH" = "skill-relay" ] || fail "db payload mismatch"
  [ "$DB_JOURNEY_ID" = "$JOURNEY_ID" ] || fail "db journey_id=$DB_JOURNEY_ID"
  [ "$CLAIMED_BY" = "session:engine-patch" ] || fail "db claimed_by=$CLAIMED_BY"
  [ -n "$CLAIMED_AT" ] || fail "db claimed_at missing"
  [ "$EXECUTOR_KIND" = "headed-session" ] || fail "db executor_kind=$EXECUTOR_KIND"
  echo "OK: db claim oracle"
}

assert_runs_concern_or_verified() {
  assert_task_payload_shape
  assert_db_claim_oracle
  RUNS=$(curl -sf "$BRAIN_URL/api/brain/harness/runs?limit=50") || fail "harness runs api"
  RUN_API_COUNT=$(echo "$RUNS" | jq --arg tid "$TASK_ID" '[.[]? | select(.initiative_id == $tid)] | length')
  GPS=$(curl -sf "$BRAIN_URL/api/brain/journeys/$JOURNEY_ID/golden-paths") || fail "journey golden-paths api"
  GP_CURRENT_REFS=$(echo "$GPS" | jq --arg tid "$TASK_ID" '[.. | strings | select(. == $tid)] | length')
  RUN_ROW=$(psql "$DB" -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$::uuid ORDER BY started_at DESC LIMIT 1")
  if [ -z "$RUN_ROW" ]; then
    echo "CONCERN: initiative_runs missing for current task; runs_api_count=$RUN_API_COUNT golden_path_refs=$GP_CURRENT_REFS; foreground takeover oracle validated"
    return 0
  fi
  IFS='|' read -r RUN_HOST RUN_PHASE RUN_STARTED_AT RUN_FAILURE_REASON <<< "$RUN_ROW"
  case "$RUN_HOST" in
    *skill-relay*codex*headed*|*codex*headed*) ;;
    *) fail "run host=$RUN_HOST" ;;
  esac
  [ "$RUN_PHASE" != "failed" ] || fail "run failed reason=$RUN_FAILURE_REASON"
  case "$RUN_PHASE" in
    A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;;
    *) fail "run phase=$RUN_PHASE" ;;
  esac
  [ -n "$RUN_STARTED_AT" ] || fail "run started_at missing"
  echo "OK: initiative_runs current run verified"
}

assert_evidence_boundary_and_redaction() {
  assert_current_task_only
  assert_task_payload_shape
  for path in "$SPRINT_DIR/tui.log" "$SPRINT_DIR/harness-report.md"; do
    if [ -f "$path" ]; then
      if grep -E 'ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}|xox[abp]-|BEGIN [A-Z ]*PRIVATE KEY|Authorization: Bearer' "$path" >/dev/null; then
        fail "sensitive token-like content in $path"
      fi
    fi
  done
  echo "OK: evidence boundary and redaction"
}

case "${1:-}" in
  --assert)
    ASSERT_NAME="${2:?missing assert name}"
    case "$ASSERT_NAME" in
      task-payload-shape) assert_task_payload_shape ;;
      db-claim-oracle) assert_db_claim_oracle ;;
      runs-concern-or-verified) assert_runs_concern_or_verified ;;
      current-task-only) assert_current_task_only ;;
      evidence-boundary-and-redaction) assert_evidence_boundary_and_redaction ;;
      *) fail "unknown assert: $ASSERT_NAME" ;;
    esac
    exit 0
    ;;
esac

assert_current_task_only
assert_task_payload_shape
assert_db_claim_oracle
assert_runs_concern_or_verified
assert_evidence_boundary_and_redaction

echo "PASS: codex headed skill-relay smoke validated for current task"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| task API payload | `../../tests/regression/relay-d355821f/contract-red.test.sh` | e2e-verify.sh 校验当前 task API payload shape | `e2e-verify.sh` 尚未实现时 FAIL |
| DB claim oracle | `../../tests/regression/relay-d355821f/contract-red.test.sh` | e2e-verify.sh 校验当前 task DB claim oracle | `e2e-verify.sh` 尚未实现时 FAIL |
| run concern 分支 | `../../tests/regression/relay-d355821f/contract-red.test.sh` | e2e-verify.sh 对 initiative_runs 缺失输出 concern 且不当作成功证据 | `e2e-verify.sh` 尚未实现时 FAIL；run 缺失不能单独 PASS |
| 当前 task 重绑定 | `../../tests/regression/relay-d355821f/contract-red.test.sh` | e2e-verify.sh 拒绝历史 task 作为当前证据 | `e2e-verify.sh` 尚未实现或接受历史 task 时 FAIL |
| 证据边界与脱敏 | `../../tests/regression/relay-d355821f/contract-red.test.sh` | e2e-verify.sh 日志证据限于当前 sprint 且脱敏 | `e2e-verify.sh` 尚未实现或日志含 secret-like 内容时 FAIL |
| local_api 全链路 | `../../tests/regression/relay-d355821f/contract-red.test.sh` | e2e-verify.sh local_api 全链路基于当前 task API 和 DB claim oracle | `e2e-verify.sh` 尚未实现或未真 curl/psql 时 FAIL |
