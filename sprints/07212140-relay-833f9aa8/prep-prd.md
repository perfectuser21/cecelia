# PrepPRD — codex-headed-smoke（833f9aa8）

## 来源与重绑定

本 PrepPRD 仅为当前 task `833f9aa8-7d17-4537-bff7-0ad4e16ca1be` 补齐 planner 最小上下文。历史同类 codex-headed-smoke sprint 只借 smoke scope，不复用历史 task id、PR、run 或 verdict。

## 当前任务事实

来源：`GET http://localhost:5221/api/brain/tasks/833f9aa8-7d17-4537-bff7-0ad4e16ca1be` 与本机 PostgreSQL。

- task title: `codex-headed-smoke`
- task_type: `harness_initiative`
- status: `in_progress`
- claimed_by: `brain-tick-7`
- claimed_at: `2026-07-21T13:40:57.907Z`
- executor_kind: `relay-container`
- journey_id: `bb8cc561-b3ee-4fec-b74d-2255694bd963`
- sprint_dir: `sprints/07212140-relay-833f9aa8`
- payload: `{"mode":"headed","executor":"codex","journey_id":"bb8cc561-b3ee-4fec-b74d-2255694bd963","sprint_dir":"sprints/07212140-relay-833f9aa8","orchestrator":"skill-relay","dispatched_by_orchestrator":true,"orchestrator_dispatched_at":"2026-07-21T06:30:28.244Z","dispatched_orchestrator_date":"2026-07-21"}`
- 当前 `initiative_runs` 最新行：`orchestrator_host=skill-relay-codex-headed`、`phase=A_planning`、`current_task_id=833f9aa8-7d17-4537-bff7-0ad4e16ca1be`

## 目标

为当前 task 固化一套可回归的 codex headed skill-relay smoke 合同资产，证明当前 task 的 task API、DB claim oracle、initiative_run host/phase 与证据边界可被真实命令复核。

## 范围

在范围内：
- 锚定当前 task 的 PRD、合同、DoD、`e2e-verify.sh` 与 contract red test。
- 真实读取 Brain task API、`tasks`、`initiative_runs` 与 harness runs API。
- 固化 `relay-container` claim + `skill-relay-codex-headed` run host 的当前事实。

不在范围内：
- 不改 Brain runtime、dashboard/UI、migrations。
- 不新增 endpoint。
- 不扩大到 headless、claude headed、历史 task 或其它 journey。

## Invariant 约束

- [单slot串行] 验收只读当前 task，不重复 spawn、认领或 kill 现有 relay 会话。
- [禁写死环境] `TASK_ID`、`SPRINT_DIR`、`BRAIN_URL`、`DATABASE_URL` 必须支持 env 覆盖。
- [真验才done] done/pass 只能来自当前 task API、DB 与当前 task run 证据。
- [凭据安全] token、私钥、Bearer credential 不进 git、不进日志、不进报告。
- [日志脱敏] 证据日志只能保留脱敏摘要。
- [端点鉴权] 本 sprint 不新增或放宽 API 端点。
- [租户隔离] 本 smoke 不涉及租户数据。

## NFR

- 可观测：必须能从 Brain API 与 DB 复核当前 task 的 claim/run 状态。
- 幂等：重复执行 `e2e-verify.sh` 只能做只读检查。
- 安全：证据文件不得包含 secret-like 内容。
- 最小变更：仅新增 smoke 合同资产。

## 建议验收

1. `GET /api/brain/tasks/<TASK_ID>` 返回当前 task，payload 包含 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`、`journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963`。
2. DB `tasks` 当前行显示 `status=in_progress`、`claimed_by=brain-tick-7`、`executor_kind=relay-container`。
3. `initiative_runs` 当前 task 行显示 `orchestrator_host=skill-relay-codex-headed` 且 phase 属于非 failed 已知集合。
4. 当前 sprint 的 `e2e-verify.sh` 与 red test 只接受当前 task，不接受历史 task 证据。

journey_type: autonomous
target_environment: local_api
