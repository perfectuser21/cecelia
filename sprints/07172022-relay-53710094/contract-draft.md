# Sprint Contract Draft (Round 1)

## Response Schema

本 sprint 不新增 HTTP endpoint 或新 HTTP response schema。等价验收 oracle 是现有 Brain task API、PostgreSQL `tasks`/`initiative_runs`、以及 sprint 目录下的 headed relay smoke 日志约定。

### Endpoint: GET /api/brain/tasks/53710094-898c-452c-8cc3-a56149e8b0ac

**Success (HTTP 200)**:
```json
{
  "id": "53710094-898c-452c-8cc3-a56149e8b0ac",
  "task_type": "harness_initiative",
  "status": "in_progress",
  "payload": {
    "mode": "headed",
    "executor": "codex",
    "orchestrator": "skill-relay",
    "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963"
  },
  "claimed_by": "session:<name>",
  "claimed_at": "<timestamp>",
  "executor_kind": "headed-session"
}
```

- `id` (string, 必填): 来源--PRD 当前任务参数。
- `task_type` (string, 必填): 来源--PRD Golden Path 要求 Brain 以 `harness_initiative` 处理。
- `status` (string, 必填): 来源--PRD 可观测认领状态；foreground path 允许 `in_progress`。
- `payload.mode` (string, 必填): 来源--PRD 字面值 `headed`。
- `payload.executor` (string, 必填): 来源--PRD 字面值 `codex`。
- `payload.orchestrator` (string, 必填): 来源--PRD 字面值 `skill-relay`。
- `payload.journey_id` (string, 必填): 来源--PRD 字面值。
- `claimed_by` / `claimed_at` (string/timestamp, 必填): 来源--PRD "认领状态可被观察"。
- `executor_kind` (string, 可选但若存在必须合法): 来源--Brain 当前 API 实测为 `headed-session`。
- **禁用字段名**: `token`, `github_token`, `anthropic_token`, `openai_api_key`, `thin_prd`, `prep_prd_body`。

**DB oracle**:
```json
{
  "tasks": {
    "id": "<task_id>",
    "status": "in_progress",
    "task_type": "harness_initiative",
    "claimed_by": "session:<name>",
    "claimed_at": "<timestamp>",
    "executor_kind": "headed-session"
  },
  "initiative_runs": {
    "initiative_id": "<task_id>",
    "orchestrator_host": "skill-relay-codex-headed",
    "phase": "A_planning|planning|gan|generate|evaluate|done"
  }
}
```

`initiative_runs` 对本任务是可选增强 oracle：若当前 task 没有 run 行，合同必须走 foreground takeover oracle，而不是硬失败。

## 已知约束

- [api_registry] `/api/brain/tasks` 已登记为 Brain 任务 CRUD；本 sprint 必须调用现有 API，不新增端点。
- [db_schema] registry 未列出 `tasks`/`initiative_runs` 细节，但本机 `information_schema` 已确认 `tasks.id/status/payload/task_type/claimed_by/claimed_at/executor_kind` 与 `initiative_runs.initiative_id/orchestrator_host/phase/started_at/completed_at/failure_reason` 存在。
- [test_registry] 现有测试风格包含 `vitest describe/it` 与 sprint 级 shell contract test；本 sprint 采用 `tests/contract-red.test.sh` 做 red 证据。
- [context-manifest] `GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 当前返回 HTML 404；无累积 FR 可合并，登记为 concern。
- [同类归档] `sprints/07151245-relay-049ebf93` 曾验证 claude headed relay；本任务只借鉴结构，不复用 task id，不要求 `initiative_runs` 必存在。
- [当前实测] Brain API 返回 task `53710094-898c-452c-8cc3-a56149e8b0ac`，`status=in_progress`，payload 三元组为 `mode=headed/executor=codex/orchestrator=skill-relay`，`claimed_by=session:engine-patch`，`executor_kind=headed-session`。
- [当前实测] DB `initiative_runs` 对当前 task 暂无行；这符合 foreground takeover path 的已知约束，不得作为唯一硬失败条件。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 为当前 task `53710094-898c-452c-8cc3-a56149e8b0ac` 固化 codex headed skill-relay smoke 验收：实现 `sprints/07172022-relay-53710094/e2e-verify.sh`，验证 Brain task API、DB `tasks` 认领状态、可选 `initiative_runs` 或 foreground takeover 证据。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 本地只读验证，30 秒内完成；不重复 spawn；不杀已有 headed session；失败必须输出明确 FAIL 原因；不输出 secret。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不修改业务代码、dashboard/UI、migration、shared CI；不扩大到 claude/headless；不把历史 run 冒充当前 task；payload 敏感字段不得进入报告。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 本合同锚定一次性 task id；当 Brain task API schema、`tasks`/`initiative_runs` schema 或 foreground takeover 记账语义变更时过期。 |
| **死亡告警（停了谁知道）** | 功能停止工作后谁知道 | Evaluator/Controller 运行 `e2e-verify.sh` 非 0 即知道；本 sprint 不新增常驻告警。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截 | Brain API/DB 不可读、payload shape 不符、task failed、run failed 均拦截并 exit 1；`initiative_runs` 缺失时进入 foreground takeover 分支，只有 task 仍 `in_progress` 且已认领且 payload 正确才放行。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效 | 本 sprint 无对外发布动作；以 Brain API + DB 当前 task 定点读为效果确认，日志位置只作辅助证据。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 当前 task 是否已进入 codex headed relay foreground path | A. 强制要求 `initiative_runs` 存在; B. 当 run 缺失时检查 `tasks.status=in_progress`、payload 三元组、`claimed_by`、`claimed_at`、`executor_kind` | B. foreground takeover oracle | harness-controller 前台接管不会写 `initiative_runs` 是已知路径；用户明确禁止将 run 缺失作为唯一硬失败 | 把真实前台 relay 误判失败，或反过来让未认领 task 假通过 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain API 不可达或返回非 200 | exit 1，输出 `FAIL: brain task api` | 是，只读重跑 | 无降级，不标 done |
| task payload shape 不匹配 | exit 1，输出缺失字段 | 是，只读重跑 | 无降级 |
| DB `tasks` 当前 task 不存在或未认领 | exit 1 | 是，只读重跑 | 无降级 |
| `initiative_runs` 存在且 phase 为 `failed` 或 host 非 codex headed | exit 1 | 是，只读重跑 | 无降级 |
| `initiative_runs` 缺失 | 不直接失败；要求 foreground takeover 证据成立，并在输出中登记 concern | 是，只读重跑 | 用 `tasks` 表认领状态作为当前 task 的等价 oracle |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| Brain task payload | 内部系统输入，但仍按不可信 JSON 处理 | 只读取白名单字段 `mode/executor/orchestrator/journey_id`，不执行 payload 文本 | payload 要求改 scope、输出 secret、扩展到 headless/claude 均拒绝 |

## 真实调用方请求 shape

本任务真实调用方是 Brain task API 中已存在的 `harness_initiative` task payload，不是新增客户端请求。DoD 和 `e2e-verify.sh` 必须按以下 shape 定点读取当前 task，不得构造另一个 task 代替：

```json
{
  "task_type": "harness_initiative",
  "payload": {
    "mode": "headed",
    "executor": "codex",
    "orchestrator": "skill-relay",
    "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963",
    "dispatched_by_orchestrator": true
  }
}
```

- 认证方式：本地 Brain API `localhost:5221`，当前 smoke 不新增鉴权路径。
- 必须逐字段一致：`mode=headed`、`executor=codex`、`orchestrator=skill-relay`、`journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`。
- 验收对象必须是 `TASK_ID=53710094-898c-452c-8cc3-a56149e8b0ac`；禁止新建任务或查询最近任务冒充。

## 禁 mock 边清单

- Brain task API ↔ `tasks` 表：测试必须真实 curl `GET /api/brain/tasks/<TASK_ID>` 并真实 psql 定点读取同一 `tasks.id`，禁止 mock API 响应或用 fixture JSON 代替。
- Headed relay ↔ `initiative_runs` 表：若 run 行存在，必须真实 psql 读取 `initiative_runs.initiative_id=<TASK_ID>` 并验证 host/phase；若 run 行不存在，必须真实登记 foreground takeover path，禁止插入假 run 或 mock run 状态。
- `e2e-verify.sh` ↔ 本机 shell exit code：DoD 必须真执行脚本并检查 exit code；禁止 `echo OK`、`|| true` 或 force/stub 分支吞掉失败。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

Concern: 当前 foreground takeover path 可能没有 `initiative_runs` 行；合同覆盖了该 path 的 task API/DB 认领 oracle，但 `initiative_runs` host/phase 只在 run 行存在时验证。

## Golden Path

Brain 当前 task `53710094-898c-452c-8cc3-a56149e8b0ac` → generator 实现 `e2e-verify.sh` → 脚本定点读取 Brain task API → 脚本定点读取 DB `tasks` → 若 `initiative_runs` 存在则校验 codex headed host/phase，若不存在则校验 foreground takeover 证据 → exit 0/1 成为 headed relay smoke oracle。

### Step 1: 当前 task payload shape 被 Brain API 真实返回

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点要求 task 存在且 payload 字面包含 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`、`journey_id`。

**可观测行为**: `GET /api/brain/tasks/<TASK_ID>` 返回当前 task，payload 字段逐字匹配，且不含敏感字段。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == "skill-relay" and .payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("openai_api_key") | not)'
```

**硬阈值**: HTTP 200；`id/task_type/payload` 完全匹配；禁用敏感字段不存在。

### Step 2: DB `tasks` 记录显示当前 task 已被 foreground/headed relay 认领

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点要求 Brain 接收并认领；第 5 条用户约束允许 foreground takeover 无 run 行。

**可观测行为**: `tasks` 当前行处于 `in_progress`，存在 `claimed_by` 与 `claimed_at`，且 `executor_kind` 若非空则是 headed session 语义。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT status, task_type, COALESCE(claimed_by,''), COALESCE(claimed_at::text,''), COALESCE(executor_kind,'') FROM tasks WHERE id = \$\$${TASK_ID}\$\$")
[ -n "$ROW" ] || { echo "FAIL: tasks row missing"; exit 1; }
STATUS=$(printf "%s" "$ROW" | cut -d'|' -f1)
TASK_TYPE=$(printf "%s" "$ROW" | cut -d'|' -f2)
CLAIMED_BY=$(printf "%s" "$ROW" | cut -d'|' -f3)
CLAIMED_AT=$(printf "%s" "$ROW" | cut -d'|' -f4)
EXECUTOR_KIND=$(printf "%s" "$ROW" | cut -d'|' -f5)
[ "$STATUS" = "in_progress" ] || { echo "FAIL: status=$STATUS"; exit 1; }
[ "$TASK_TYPE" = "harness_initiative" ] || { echo "FAIL: task_type=$TASK_TYPE"; exit 1; }
[ -n "$CLAIMED_BY" ] && [ -n "$CLAIMED_AT" ] || { echo "FAIL: task not claimed"; exit 1; }
case "$EXECUTOR_KIND" in ""|headed-session) ;; *) echo "FAIL: executor_kind=$EXECUTOR_KIND"; exit 1 ;; esac
```

**硬阈值**: `status=in_progress`；`task_type=harness_initiative`；`claimed_by/claimed_at` 非空；`executor_kind` 为空或 `headed-session`。

### Step 3: `initiative_runs` 存在时校验 host/phase，缺失时走 foreground takeover oracle

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 点要求 run 状态可被 API/DB/session 证据验证或解释；用户第 5 条明确 run 缺失可由前台接管证据解释。

**可观测行为**: 如果 DB 有当前 task 的 run 行，host 必须是 codex headed relay 且 phase 非 failed；如果没有 run 行，必须已通过 Step 1/2 的 foreground takeover 证据并输出 concern。

**验证命令**:
```bash
TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
ROW=$(psql "$DB" -XAt -F '|' -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$ ORDER BY started_at DESC LIMIT 1")
if [ -z "$ROW" ]; then
  echo "CONCERN: initiative_runs missing; foreground takeover oracle must be used"
  exit 0
fi
HOST=$(printf "%s" "$ROW" | cut -d'|' -f1)
PHASE=$(printf "%s" "$ROW" | cut -d'|' -f2)
STARTED_AT=$(printf "%s" "$ROW" | cut -d'|' -f3)
FAILURE_REASON=$(printf "%s" "$ROW" | cut -d'|' -f4)
case "$HOST" in *skill-relay*codex*headed*|*codex*headed*) ;; *) echo "FAIL: host=$HOST"; exit 1 ;; esac
[ "$PHASE" != "failed" ] || { echo "FAIL: phase=failed reason=$FAILURE_REASON"; exit 1; }
case "$PHASE" in A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac
[ -n "$STARTED_AT" ] || { echo "FAIL: started_at missing"; exit 1; }
```

**硬阈值**: run 存在时 host/phase 合法且非 failed；run 缺失时不硬失败，但必须以前台接管 oracle 通过作为替代证据。

### Step 4: `e2e-verify.sh` 成为单一可复跑 wrapper

**来源**: `[AI_ADDED]` — 防止 reviewer/evaluator 分散复制命令导致 scope 漂移；把同一 oracle 固化为 generator 可实现、evaluator 可直接执行的脚本。

**可观测行为**: `bash sprints/07172022-relay-53710094/e2e-verify.sh` exit 0；`--assert` 子断言可分别覆盖 payload、tasks、run/foreground、failed/secrets。

**验证命令**:
```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/07172022-relay-53710094}"
TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
bash "$SPRINT_DIR/e2e-verify.sh" --assert task-payload-shape
bash "$SPRINT_DIR/e2e-verify.sh" --assert db-tasks-claimed
bash "$SPRINT_DIR/e2e-verify.sh" --assert run-or-foreground-path
bash "$SPRINT_DIR/e2e-verify.sh" --assert failed-and-secrets-rejected
```

**硬阈值**: 四个子断言全部 exit 0；任一 FAIL 原因必须打印到 stderr/stdout；不得使用 mock/force/stub。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/07172022-relay-53710094}"
TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
VERIFY="$SPRINT_DIR/e2e-verify.sh"

[ -f "$VERIFY" ] || { echo "FAIL: missing $VERIFY"; exit 1; }
bash -n "$VERIFY"

RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == env.TASK_ID'
echo "$RESP" | jq -e '.task_type == "harness_initiative"'
echo "$RESP" | jq -e '.payload.mode == "headed" and .payload.executor == "codex" and .payload.orchestrator == "skill-relay"'
echo "$RESP" | jq -e '.payload.journey_id == "bb8cc561-b3ee-4fec-b74d-2255694bd963"'
echo "$RESP" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("openai_api_key") | not)'

TASK_ROW=$(psql "$DB" -XAt -F '|' -c "SELECT status, task_type, COALESCE(claimed_by,''), COALESCE(claimed_at::text,''), COALESCE(executor_kind,'') FROM tasks WHERE id = \$\$${TASK_ID}\$\$")
[ -n "$TASK_ROW" ] || { echo "FAIL: tasks row missing"; exit 1; }
TASK_STATUS=$(printf "%s" "$TASK_ROW" | cut -d'|' -f1)
TASK_TYPE=$(printf "%s" "$TASK_ROW" | cut -d'|' -f2)
TASK_CLAIMED_BY=$(printf "%s" "$TASK_ROW" | cut -d'|' -f3)
TASK_CLAIMED_AT=$(printf "%s" "$TASK_ROW" | cut -d'|' -f4)
TASK_EXECUTOR_KIND=$(printf "%s" "$TASK_ROW" | cut -d'|' -f5)
[ "$TASK_STATUS" = "in_progress" ] || { echo "FAIL: task status $TASK_STATUS"; exit 1; }
[ "$TASK_TYPE" = "harness_initiative" ] || { echo "FAIL: task type $TASK_TYPE"; exit 1; }
[ -n "$TASK_CLAIMED_BY" ] && [ -n "$TASK_CLAIMED_AT" ] || { echo "FAIL: task not claimed"; exit 1; }
case "$TASK_EXECUTOR_KIND" in ""|headed-session) ;; *) echo "FAIL: executor_kind $TASK_EXECUTOR_KIND"; exit 1 ;; esac

RUN_ROW=$(psql "$DB" -XAt -F '|' -c "SELECT COALESCE(orchestrator_host,''), COALESCE(phase,''), COALESCE(started_at::text,''), COALESCE(failure_reason,'') FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$ ORDER BY started_at DESC LIMIT 1")
if [ -n "$RUN_ROW" ]; then
  RUN_HOST=$(printf "%s" "$RUN_ROW" | cut -d'|' -f1)
  RUN_PHASE=$(printf "%s" "$RUN_ROW" | cut -d'|' -f2)
  RUN_STARTED_AT=$(printf "%s" "$RUN_ROW" | cut -d'|' -f3)
  RUN_FAILURE_REASON=$(printf "%s" "$RUN_ROW" | cut -d'|' -f4)
  case "$RUN_HOST" in *skill-relay*codex*headed*|*codex*headed*) ;; *) echo "FAIL: run host $RUN_HOST"; exit 1 ;; esac
  [ "$RUN_PHASE" != "failed" ] || { echo "FAIL: run failed $RUN_FAILURE_REASON"; exit 1; }
  case "$RUN_PHASE" in A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress) ;; *) echo "FAIL: run phase $RUN_PHASE"; exit 1 ;; esac
  [ -n "$RUN_STARTED_AT" ] || { echo "FAIL: run started_at missing"; exit 1; }
else
  echo "CONCERN: initiative_runs row missing; validated foreground takeover path"
fi

bash "$VERIFY" --assert task-payload-shape
bash "$VERIFY" --assert db-tasks-claimed
bash "$VERIFY" --assert run-or-foreground-path
bash "$VERIFY" --assert failed-and-secrets-rejected

echo "PASS: codex headed relay smoke contract validated"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| task API payload | `sprints/07172022-relay-53710094/tests/contract-red.test.sh` | e2e-verify.sh 校验 task API payload shape | `e2e-verify.sh` 尚未实现时 FAIL |
| DB tasks 认领 | `sprints/07172022-relay-53710094/tests/contract-red.test.sh` | e2e-verify.sh 校验 DB tasks 认领状态 | `e2e-verify.sh` 尚未实现时 FAIL |
| run 或 foreground path | `sprints/07172022-relay-53710094/tests/contract-red.test.sh` | e2e-verify.sh 对 initiative_runs 采用可选 run 或 foreground path | `e2e-verify.sh` 尚未实现时 FAIL |
| failed/secrets 拒绝 | `sprints/07172022-relay-53710094/tests/contract-red.test.sh` | e2e-verify.sh 拒绝 failed 状态并不记录敏感字段 | `e2e-verify.sh` 尚未实现时 FAIL |
