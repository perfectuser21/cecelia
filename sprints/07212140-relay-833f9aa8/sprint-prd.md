# Sprint PRD — codex-headed-smoke 833f9aa8 容器认领 smoke

## 背景

当前 task `833f9aa8-7d17-4537-bff7-0ad4e16ca1be` 已被 Brain 认领，且与历史前台 takeover 型 smoke 不同：当前真实事实是 `claimed_by=brain-tick-7`、`executor_kind=relay-container`、`initiative_runs.orchestrator_host=skill-relay-codex-headed`、`phase=A_planning`。本 sprint 要把这条真实 headed relay 容器认领链路固化为可回归资产。

## Golden Path

1. 当前 task API 返回 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`、`journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`。
2. 当前 DB `tasks` 行返回 `status=in_progress`、`claimed_by=brain-tick-7`、`claimed_at` 非空、`executor_kind=relay-container`。
3. 当前 `initiative_runs` 行返回 `initiative_id=833f9aa8-7d17-4537-bff7-0ad4e16ca1be`、`orchestrator_host=skill-relay-codex-headed`、`phase=A_planning` 且非 failed。
4. `scripts/smoke/e2e/relay-833f9aa8.sh` 与 `tests/regression/relay-833f9aa8/contract-red.test.sh` 只对当前 task 通过，不接受历史 task/run 或 secret 泄露。

## 边界情况

- Brain task payload 含 `sprint_dir` 是当前事实，不得像旧 smoke 那样把 `sprint_dir` 视为禁用字段。
- `host.docker.internal` 在本机不可解析，验收必须使用 `http://localhost:5221`。
- harness runs API 只暴露 phase，不暴露 `orchestrator_host`；host 需要 DB `initiative_runs` 定点读。
- 若 `initiative_runs` 不存在或 phase=failed，则当前 smoke FAIL；这次不是前台 concern 路径。

## 范围限定

在范围内：
- 新增当前 sprint 的 `contract-draft.md`、`contract-dod.md`，并已毕业测试资产到 `tests/regression/relay-833f9aa8/` 与 `scripts/smoke/e2e/relay-833f9aa8.sh`。

不在范围内：
- 不修改运行时代码、CI 流程、dashboard、数据库结构。

## NFR

- 可观测：每个 PASS 都要能追溯到当前 task 的 API/DB 证据。
- 安全：日志和报告不含 token、私钥、Bearer credential。
- 幂等：wrapper 只读、可重复执行。
- 最小变更：只落 smoke 合同资产。

## Invariant 约束

- [单slot串行] 验收过程禁止重复 spawn、认领或 kill 当前 relay run。
- [禁写死环境] `TASK_ID`、`SPRINT_DIR`、`BRAIN_URL`、`DATABASE_URL` 可由 env 覆盖。
- [真验才done] 不允许用历史 task `53710094`、`d355821f` 或任何其他 run 冒充当前结论。
- [凭据安全] 证据文件与脚本不得打印 secrets。
- [日志脱敏] 当前 sprint 日志存在时必须通过 secret-like 扫描。
- [端点鉴权] 本 sprint 不新增端点。
- [租户隔离] 本 sprint 不碰租户数据。

## 累积 FR

- FR-001 当前 task payload shape：task API 必须返回当前 task，payload 三元组与 journey_id 匹配。
- FR-002 当前 task DB claim oracle：`tasks` 行必须返回 `status=in_progress`、`claimed_by=brain-tick-7`、`executor_kind=relay-container`。
- FR-003 当前 task run host oracle：`initiative_runs` 行必须返回 `orchestrator_host=skill-relay-codex-headed`，phase 属于已知非 failed 集合。
- FR-004 当前 task 重绑定：wrapper 与 tests 只能接受当前 `TASK_ID` 和当前 `SPRINT_DIR`。
- FR-005 证据边界与脱敏：当前 sprint 证据文件存在时不得包含 secret-like 内容。

## E2E 验收

```bash
# generator 将实现以下入口：
# 1. bash scripts/smoke/e2e/relay-833f9aa8.sh --assert task-payload-shape
# 2. bash scripts/smoke/e2e/relay-833f9aa8.sh --assert db-claim-oracle
# 3. bash scripts/smoke/e2e/relay-833f9aa8.sh --assert run-host-phase
# 4. bash scripts/smoke/e2e/relay-833f9aa8.sh --assert current-task-only
# 5. bash scripts/smoke/e2e/relay-833f9aa8.sh --assert evidence-boundary-and-redaction
# 6. bash scripts/smoke/e2e/relay-833f9aa8.sh
```

## 未覆盖真实链路清单

N/A。本合同覆盖的真实链路就是当前 task 的 task API、DB claim、initiative_run host/phase 与证据边界；其它 executor 或历史 task 不属于本合同范围。

## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none
journey_type: autonomous
journey_type_reason: 纯 Brain/harness 后端 smoke，无 UI 交互。
target_environment: local_api
target_environment_reason: 所有证据都来自本机 Brain API 与 PostgreSQL。
