# PrepPRD — codex-headed-smoke

## 背景

本任务由 harness-controller 派发给 Step 1 Planner，用于验证 Cecelia harness skill-relay 的 Codex headed 派发链路。当前 task payload 很薄，仅提供 `mode`、`executor`、`journey_id`、`orchestrator` 与派发元数据，没有 `prep_prd_body` 或 `thin_prd`。

事实来源采用同类已完成的 codex/headed relay smoke 的 PrepPRD 与 Sprint PRD；本归档只借鉴其 smoke scope，不复用历史 task id，也不扩大业务范围。

## 当前任务参数

- TASK_ID: `53710094-898c-452c-8cc3-a56149e8b0ac`
- SPRINT_DIR: `sprints/07172022-relay-53710094`
- BRAIN_URL: `http://localhost:5221`
- task title: `codex-headed-smoke`
- journey_id: `bb8cc561-b3ee-4fec-b74d-2255694bd963`
- payload: `{"mode":"headed","executor":"codex","journey_id":"bb8cc561-b3ee-4fec-b74d-2255694bd963","orchestrator":"skill-relay","dispatched_by_orchestrator":true,"orchestrator_dispatched_at":"2026-07-17T03:40:09.293Z","dispatched_orchestrator_date":"2026-07-17"}`

## 目标

验证 `executor=codex + mode=headed + orchestrator=skill-relay` 的 `harness_initiative` 能被 Brain 接收、认领，并具备 headed relay smoke 可观测状态。

## 范围

在范围内：
- 读取当前 task 与 initiative_run 状态。
- 使用当前工作区作为 Cecelia base repo。
- 补齐 planner 可消费的最小上下文。
- 验证 headed relay 关键可观测信号：task payload、认领状态、initiative_runs/headed relay host 或 phase、sprint_dir/tui.log 约定。

不在范围内：
- 不扩展业务功能。
- 不改 dashboard/UI。
- 不改 migrations。
- 不创建 PR，不跨 repo promote。
- 不扩大到 headless 或其他 executor smoke。

## base_repo

`/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-53710094`

说明：`target_environment=local_api` 允许本地路径；本任务是 Cecelia 内部 Brain/harness smoke。若下游必须使用 GitHub URL，可等价使用 `https://github.com/perfectuser21/cecelia.git`，但不得输出或记录带 token 的 remote URL。

## target_environment

`local_api`

理由：验收信号来自本地 Brain API `localhost:5221`、PostgreSQL 查询和本机 headed relay session 观测；无需浏览器或远端 runner。

## journey_type

`autonomous`

理由：纯 Brain/harness 后端派发链路 smoke，无用户可见 UI 交互，无 engine pipeline 变更。

## review_required

建议：`false`

理由：本阶段只归档 PRD 与 smoke 合同，不改业务代码、不创建 PR。

## NFR

- 可观测：必须能通过 Brain API/DB 看到 task 与 initiative_runs 状态。
- 安全：不得把 GitHub token、Codex 凭据、prompt 全文中的敏感内容写入报告或日志。
- 幂等：若已有 headed session 或 initiative_run，后续动作不得重复 spawn 或误杀现有 session。
- 本地验证：所有 done 结论必须基于本机真实命令/API/DB 证据。
- 最小变更：本任务只固化 smoke 验收边界，不应生成无关代码改动。

## 铁律清单

- 单 slot 串行：同一 slot/session 内严格串行，不并发写同一工作区。
- 禁写死环境假设：端口、路径、ssh host、凭据目录等优先读取 payload/env/当前工作区；缺失时只做保守推断并注明来源。
- 真环境验证才 done：未实际验证 Brain API/DB/tmux 信号前不能标 done。
- 凭据安全：secrets 不硬编码、不进 git、不进日志；报告中不得复述 token。
- 日志脱敏：不输出明文 token、客户隐私或完整敏感 prompt。
- 端点鉴权：若后续触及 API 变更，不得新增无鉴权可交付端点。
- 租户隔离：若后续触及租户数据，查询/写入必须 scope 到当前租户；本 smoke 当前未触及租户数据。

## 建议验收

1. `GET /api/brain/tasks/53710094-898c-452c-8cc3-a56149e8b0ac` 返回 task，payload 含 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`。
2. task 处于 Brain 可认领/已认领状态，且可观察到 headed relay smoke 的 run 状态。
3. 若需要继续执行 proposer/evaluator，应只围绕 headed relay smoke 补齐合同，不引入新业务范围。
