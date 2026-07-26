# Sprint Contract Draft — codex-headed-smoke 833f9aa8

## Response Schema

本 sprint 不新增 endpoint；验收复用现有 Brain task API、harness runs API 与 PostgreSQL `tasks`/`initiative_runs`。

### Endpoint: GET /api/brain/tasks/833f9aa8-7d17-4537-bff7-0ad4e16ca1be

**Success (HTTP 200)**:

```json
{
  "id": "833f9aa8-7d17-4537-bff7-0ad4e16ca1be",
  "task_type": "harness_initiative",
  "status": "in_progress",
  "claimed_by": "brain-tick-7",
  "claimed_at": "<timestamp>",
  "executor_kind": "relay-container",
  "payload": {
    "mode": "headed",
    "executor": "codex",
    "orchestrator": "skill-relay",
    "journey_id": "bb8cc561-b3ee-4fec-b74d-2255694bd963",
    "sprint_dir": "sprints/07212140-relay-833f9aa8",
    "dispatched_by_orchestrator": true
  }
}
```

- `payload.mode` = `headed`
- `payload.executor` = `codex`
- `payload.orchestrator` = `skill-relay`
- `payload.journey_id` = `bb8cc561-b3ee-4fec-b74d-2255694bd963`
- `payload.sprint_dir` = `sprints/07212140-relay-833f9aa8`
- 禁用字段：`token`、`github_token`、`anthropic_token`、`openai_api_key`、`codex_token`、`prep_prd_body`、`thin_prd`

### DB Oracle

`tasks.id=833f9aa8-7d17-4537-bff7-0ad4e16ca1be` 必须返回：

- `status=in_progress`
- `task_type=harness_initiative`
- `payload.mode=headed`
- `payload.executor=codex`
- `payload.orchestrator=skill-relay`
- `payload.journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`
- `claimed_by=brain-tick-7`
- `claimed_at` 非空
- `executor_kind=relay-container`

`initiative_runs.initiative_id=833f9aa8-7d17-4537-bff7-0ad4e16ca1be` 最新行必须返回：

- `orchestrator_host=skill-relay-codex-headed`
- `phase` 属于 `A_planning|planning|gan|generate|evaluate|done|completed|running|in_progress`
- `phase != failed`
- `started_at` 非空

## 已知约束

- [当前实测] `host.docker.internal` 不可达；本机 `http://localhost:5221` 可达。
- [当前实测] task 由 Brain 认领，`claimed_by=brain-tick-7`，不是前台 takeover。
- [当前实测] `initiative_runs` 已存在当前 task 行，host=`skill-relay-codex-headed`，phase=`A_planning`。
- [api_registry] harness runs API 不返回 `orchestrator_host`，host 只能从 DB 读取。
- [历史边界] `d355821f` 是 foreground takeover smoke，不得拿来替代当前容器认领 smoke。

## 八要素需求规范

| 要素 | 本次答案 |
| --- | --- |
| FR | FR-001..FR-005：当前 task payload、DB claim、run host/phase、当前 task 重绑定、证据脱敏 |
| NFR | local_api、只读幂等、证据脱敏、最小变更 |
| Invariant | 单slot串行、禁写死环境、真验才done、凭据安全、日志脱敏 |
| 判定点 | 只有当前 task API + 当前 DB 行 + 当前 task run 才算有效证据 |
| 保质期 | 当 Brain task schema、claim 语义、initiative_runs host/phase 语义变化时过期 |
| 死亡告警 | evaluator/controller 执行 `scripts/smoke/e2e/relay-833f9aa8.sh` 或 DoD `manual:bash` 非 0 即告警 |
| 失败语义 | task API/DB/run 任一锚点失败即 FAIL；不允许 concern 放过 |
| 效果确认 | `scripts/smoke/e2e/relay-833f9aa8.sh` exit 0 才算当前 task smoke 生效 |

## 失败语义声明

| 场景 | 失败行为 |
| --- | --- |
| task API 不可达或字段漂移 | FAIL |
| DB `tasks` 行缺失、未认领或 executor_kind 漂移 | FAIL |
| `initiative_runs` 行缺失、host 非 `skill-relay-codex-headed`、phase=failed/unknown | FAIL |
| 使用历史 task/sprint 作为当前证据 | FAIL |
| 日志或报告命中 secret-like 内容 | FAIL |

## 禁 mock 边清单

- `scripts/smoke/e2e/relay-833f9aa8.sh` 必须真实 `curl` 当前 task API。
- `scripts/smoke/e2e/relay-833f9aa8.sh` 必须真实 `psql` 当前 `tasks` 与 `initiative_runs`。
- 禁止 `MOCK_*`、`stub`、`|| true`、无条件 `exit 0`。
- 禁止读取最近 run、历史 sprint 或其它 task 作为替代证据。

## L3 真目标复核

- [BEHAVIOR] verification_level: L3 真目标复核：codex-headed-smoke 833f9aa8 的 PASS 只能由真实 Brain API + PostgreSQL 当前 task 证据给出，不接受 mock/stub/fixture 或历史 run 替代。

## Golden Path

### Step 1: 当前 task API payload shape 正确

验证当前 task、当前 payload、禁用字段。

### Step 2: 当前 DB claim oracle 正确

验证 `claimed_by=brain-tick-7`、`executor_kind=relay-container`。

### Step 3: 当前 run host/phase 正确

验证 `orchestrator_host=skill-relay-codex-headed` 与合法 phase。

### Step 4: 当前 task 重绑定与证据脱敏

验证 `TASK_ID`/`SPRINT_DIR` 绑定当前 sprint，扫描日志 secret-like 内容。

## E2E 验收

```bash
#!/usr/bin/env bash
set -euo pipefail
TASK_ID="${TASK_ID:-833f9aa8-7d17-4537-bff7-0ad4e16ca1be}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
bash scripts/smoke/e2e/relay-833f9aa8.sh --assert task-payload-shape
bash scripts/smoke/e2e/relay-833f9aa8.sh --assert db-claim-oracle
bash scripts/smoke/e2e/relay-833f9aa8.sh --assert run-host-phase
bash scripts/smoke/e2e/relay-833f9aa8.sh --assert current-task-only
bash scripts/smoke/e2e/relay-833f9aa8.sh --assert evidence-boundary-and-redaction
bash scripts/smoke/e2e/relay-833f9aa8.sh
```

## Test Contract

| Behavior | Test File | Assertion | Red |
| --- | --- | --- | --- |
| task API payload | `../../tests/regression/relay-833f9aa8/contract-red.test.sh` | relay-833f9aa8.sh 校验当前 task API payload shape | wrapper 尚未实现时 FAIL |
| DB claim oracle | `../../tests/regression/relay-833f9aa8/contract-red.test.sh` | relay-833f9aa8.sh 校验当前 task DB claim oracle | wrapper 尚未实现时 FAIL |
| run host phase | `../../tests/regression/relay-833f9aa8/contract-red.test.sh` | relay-833f9aa8.sh 校验当前 task run host 与 phase | wrapper 尚未实现或接受错误 host/phase 时 FAIL |
| 当前 task 重绑定 | `../../tests/regression/relay-833f9aa8/contract-red.test.sh` | relay-833f9aa8.sh 拒绝历史 task 作为当前证据 | wrapper 尚未实现或接受历史 task 时 FAIL |
| 证据边界与脱敏 | `../../tests/regression/relay-833f9aa8/contract-red.test.sh` | relay-833f9aa8.sh 日志证据限于当前 sprint 且脱敏 | wrapper 尚未实现或日志含 secret-like 内容时 FAIL |
| local_api 全链路 | `../../tests/regression/relay-833f9aa8/contract-red.test.sh` | relay-833f9aa8.sh local_api 全链路基于当前 task API 与 DB | wrapper 尚未实现或未真 curl/psql 时 FAIL |
| L3 真目标复核 | `../../tests/regression/relay-833f9aa8/contract-red.test.sh` | verification_level: L3 真目标复核 | wrapper 未真实 curl/psql 或含 mock/stub/吞错时 FAIL |

## 未覆盖真实链路清单

N/A
