# PrepPRD — headed-smoke-test

## 背景
本任务由 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh` 创建，用于验证 Cecelia harness skill-relay 的 Codex headed 派发链路。它不是新业务功能需求，而是对现有 Brain headed relay 通道的 smoke/交接补齐。

## 目标
验证 `executor=codex + mode=headed + orchestrator=skill-relay` 的 harness_initiative 能被 Brain 接收、派发并写入 headed relay run 状态。

## 范围
在范围内：
- 读取目标 task 与 initiative_run 状态。
- 使用当前工作区作为 Cecelia base repo。
- 补齐 planner 可消费的最小上下文。
- 验证 headed relay 关键可观测信号：task payload、initiative_runs.orchestrator_host、sprint_dir/tui.log 约定。

不在范围内：
- 不扩展业务功能。
- 不改 dashboard/UI。
- 不改 migrations，除非后续 planner 发现现有 headed smoke 合同明确要求。
- 不跨 repo 生产 promote。

## base_repo
`/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-a85e0582`

说明：`target_environment=local_api` 允许本地路径；本任务是 Cecelia 内部 Brain/harness smoke。若下游必须用 GitHub URL，可等价使用 `https://github.com/perfectuser21/cecelia.git`，但不得输出或记录带 token 的 remote URL。

## target_environment
`local_api`

理由：验收信号来自本地 Brain API `localhost:5221`、PostgreSQL 查询和本机 ssh/tmux/codex headed session；无需浏览器或远端 runner。

## journey_type
`autonomous`

理由：纯 Brain/harness 后端派发链路 smoke，无用户可见 UI 交互，无 engine pipeline 变更。

## review_required
建议：`true`

理由：payload 未显式提供；标题不是 fix/chore/修复/bug，也没有 `change_kind=fix|small|thicken`。按现有 `deriveReviewRequired` 规则，未知/判定不出默认 true，安全方向是人工看一眼。

## NFR
- 可观测：必须能通过 Brain API/DB 看到 task 与 initiative_runs 状态。
- 安全：不得把 GitHub token、Codex 凭据、prompt 全文中的敏感内容写入报告或日志。
- 幂等：若已有 headed tmux session 或 initiative_run，后续动作不得重复 spawn 或误杀现有 session。
- 本地验证：所有 done 结论必须基于本机真实命令/API/DB 证据。
- 最小变更：本任务优先视为 smoke 验证，不应生成无关代码改动。

## 铁律清单
- 单 slot 串行：同一 slot/session 内严格串行，不并发写同一工作区。
- 禁写死环境假设：端口、路径、ssh host、凭据目录等优先读取 payload/env/当前工作区；缺失时只做保守推断并注明来源。
- 真环境验证才 done：未实际验证 Brain API/DB/tmux 信号前不能标 done。
- 凭据安全：secrets 不硬编码、不进 git、不进日志；报告中不得复述 token。
- 日志脱敏：不输出明文 token、客户隐私或完整敏感 prompt。
- 端点鉴权：若后续触及 API 变更，不得新增无鉴权可交付端点。
- 租户隔离：若后续触及租户数据，查询/写入必须 scope 到当前租户；本 smoke 当前未触及租户数据。

## 建议验收
1. `GET /api/brain/tasks/a85e0582-5d88-4f0b-bce6-302d898b01e7` 返回 task，payload 含 `mode=headed`, `executor=codex`, `orchestrator=skill-relay`。
2. DB `initiative_runs` 中该 initiative_id 有 `orchestrator_host='skill-relay-codex-headed'` 且 `phase='A_planning'`。
3. 若需要继续执行 planner，应只围绕 headed relay smoke 补齐合同，不引入新业务范围。
