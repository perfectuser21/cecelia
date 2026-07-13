# Sprint PRD — headed-smoke-test 回归链路固化

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：不扩展功能，只把已 5/5 通过的 headed-smoke-test 交接验证范围固化为可消费 PRD。

## 背景

本 sprint 是 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh` 触发的 harness headed relay smoke 交接补齐。目标不是新功能，而是验证 `executor=codex + mode=headed + orchestrator=skill-relay` 的 `harness_initiative` 已被 Brain 接收、派发，并具备可观测 run 状态。

## Golden Path（核心场景）

系统从 headed-smoke-test task 进入 → 读取 Brain task 与 initiative_run 状态 → 确认 headed relay 的关键观测信号完整 → 输出仅供后续 proposer/evaluator 消费的回归验收边界。

具体：
1. 触发条件：task `a85e0582-5d88-4f0b-bce6-302d898b01e7` 存在，payload 字面包含 `mode=headed`、`executor=codex`、`orchestrator=skill-relay`。
2. 系统处理：Brain run 进入 planner 阶段，并把该 initiative 作为 `autonomous`/`local_api` harness smoke 处理。
3. 可观测结果：task payload、initiative_runs 的 headed relay host/phase、以及 sprint_dir/tui.log 约定可被本机 API/DB/tmux 证据验证。

## 边界情况

- 已存在 headed tmux session 或 initiative_run 时，只验证现有状态，不重复 spawn，不误杀会话。
- Brain API 或 DB 暂不可读时，不能标 done，只能记录缺失证据。
- 报告与日志不得包含 GitHub token、Codex 凭据、完整敏感 prompt 或客户隐私。

## 范围限定

**在范围内**：读取目标 task、initiative_run、headed relay 关键状态；固化 headed-smoke-test 回归验收链路；保留当前工作区作为 Cecelia base repo。

**不在范围内**：不新增业务功能；不改 dashboard/UI；不改 migrations；不跨 repo promote；不扩大到 headless 或其他 executor smoke。

## 假设

- [ASSUMPTION: 当前 task payload 没有 `thin_prd` 字段，本 PRD 以 PrepPRD 的 `headed-smoke-test` 与 task payload 三元组作为 scope 锚点。]
- [ASSUMPTION: `orchestrator_host='skill-relay-codex-headed'` 以 DB `initiative_runs` 为最终验收源，Brain runs API 若未返回该字段不替代 DB 验收。]

## 预期受影响文件

- `sprints/07130752-relay-a85e0582/sprint-prd.md`: planner scope 锚定产物。
- `sprints/07130752-relay-a85e0582/prep-prd.md`: PrepPRD 原文归档，便于后续交接追溯。

## NFR 约束

- 可观测：必须能通过 Brain API/DB 看到 task 与 initiative_runs 状态。
- 安全：secrets 不硬编码、不进 git、不进日志；报告不得复述 token 或敏感 prompt。
- 幂等：已有 headed session/run 时不得重复 spawn 或误杀。
- 本地验证：done 结论必须基于本机真实命令/API/DB/tmux 证据。
- 最小变更：仅验证/固化 headed-smoke-test 回归链路，不生成无关代码改动。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [单slot串行] 一个 slot/会话内严格串行执行任务；需要并行时用多个 slot/独立 session（来源: area）
- [禁写死假设] 端口、路径、ssh host、凭据目录等优先读取 payload/env/当前工作区（来源: area）
- [真验才done] 未实际验证 Brain API/DB/tmux 信号前不能标 done（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 不输出明文 token、客户隐私或完整敏感 prompt（来源: area）
- [端点鉴权] 若后续触及 API 变更，不得新增无鉴权可交付端点（来源: area）
- [租户隔离] 若后续触及租户数据，查询/写入必须 scope 到当前租户（来源: area）
- [服务判活] 服务存活判定使用 launchctl 状态 + 端口监听双信号（来源: area）
- [常驻服务] 新增常驻宿主服务时必须同步 launchd-patrol manifest（来源: area）
- [新task接线] 新 task_type 接线需覆盖约束、路由表、executor 分支、relay loadSkill 与 dispatcher 防线（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：
# 1. GET /api/brain/tasks/a85e0582-5d88-4f0b-bce6-302d898b01e7 返回 task，payload 含 mode=headed、executor=codex、orchestrator=skill-relay。
# 2. DB initiative_runs 中该 initiative_id 有 orchestrator_host='skill-relay-codex-headed' 且 phase='A_planning'。
# 3. sprint_dir/tui.log 约定存在或能解释为当前 headed relay smoke 的可观测输出位置。
```

journey_type: autonomous
target_environment: local_api
