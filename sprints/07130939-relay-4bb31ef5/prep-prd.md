# PrepPRD — claude-headed-smoke

## 背景
本任务由 Brain harness dispatch 创建（task_type=harness_initiative，payload.mode=headed，payload.executor=claude，payload.orchestrator=skill-relay），用于验证 Cecelia harness skill-relay 的 **Claude headed** 派发链路。它不是新业务功能需求，而是对现有 Brain headed relay 通道的 smoke/回归补齐。

它是已合并 #3827「headed smoke regression wrapper」（codex-headed，sprint 07130752-relay-a85e0582）的**同构镜像版**：把 executor 从 `codex` 换成 `claude`，把 orchestrator_host 从 `skill-relay-codex-headed` 换成 `skill-relay-claude-headed`。

## 目标
验证 `executor=claude + mode=headed + orchestrator=skill-relay` 的 harness_initiative 能被 Brain 接收、派发并写入 headed relay run 状态，并把该验收固化成一个可被 CI 持续回归的本地 wrapper。

## 范围
在范围内：
- 新增 `sprints/07130939-relay-4bb31ef5/e2e-verify.sh`：复用既有 headed dispatch smoke，并定点验证**当前 claude-headed task** 的 payload、initiative_runs headed relay 状态（host=`skill-relay-claude-headed`）、本地 sprint/tui.log 外部真相或 relay 源码留痕机制。
- 新增/登记 claude-headed dispatch smoke 脚本入口（见"判定点：smoke 复用 vs 新建"）。
- **修改 `.github/workflows/ci.yml` 的 DoD 动态验证 seed 步骤**，使其在 task-card/DoD 含 claude-headed 标记时 seed `orchestrator_host='skill-relay-claude-headed'` + `payload.executor='claude'` 的 task/run —— 否则我的 e2e-verify 在 CI 里断言 claude-headed 会跑在 codex-headed 的 seed 数据上必红（**这是本 sprint 与 codex 版最大的差异点，必须覆盖**）。
- 更新 DoD.md 记录本 sprint 的 headed relay DoD。

不在范围内：
- 不扩展业务功能，不改 dashboard/UI。
- 不改 migrations。
- 不跨 repo 生产 promote。
- 不改动 codex-headed 既有 smoke/wrapper 语义（只做加法，不回归 codex 路径）。

## base_repo
`cecelia`（当前 worktree `/Users/administrator/worktrees/task-4bb31ef5/session-073e021f`）。target_environment=local_api 允许本地路径；不得输出或记录带 token 的 remote URL。

## target_environment
`local_api`

理由：验收信号来自本地 Brain API `localhost:5221`、PostgreSQL `initiative_runs` 查询与本机 sprint 日志；无需浏览器或远端 runner。

## journey_type
`autonomous`

理由：纯 Brain/harness 后端派发链路 smoke，无用户可见 UI 交互，无 engine pipeline 变更。

## review_required
`false`（建议）

理由：本任务是既有能力的 smoke/CI 回归补齐（chore/test 性质），非高风险不可逆动作，只读验证 + CI 接线。若 Brain payload 显式给了 review_required 以其为准。

## NFR
- 可观测：必须能通过 Brain API/DB 看到 task 与 initiative_runs 状态。
- 安全：不得把 GitHub token、Claude/Anthropic 凭据、prompt 全文中的敏感内容写入报告或日志。
- 幂等：只读验证，重跑幂等；不重复 spawn，不误杀现有 headed session。
- 本地验证：所有 done 结论必须基于本机真实命令/API/DB 证据。
- 最小变更：优先视为 smoke/CI 回归补齐，不生成无关代码改动。
- CI 回归宿主：新增的 e2e-verify.sh 与 smoke 必须被 CI（smoke-glob / DoD 动态验证 / e2e paths）持续收集，不能"只活一次"。

## 铁律清单
- 单 slot 串行：同一 slot/session 内严格串行，不并发写同一工作区。
- 禁写死环境假设：端口、路径、host、凭据目录等优先读取 payload/env/当前工作区；缺失时只做保守推断并注明来源。
- 真环境验证才 done：未实际验证 Brain API/DB 信号前不能标 done。
- 凭据安全：secrets 不硬编码、不进 git、不进日志；报告中不得复述 token。
- 日志脱敏：不输出明文 token、客户隐私或完整敏感 prompt；e2e-verify.sh 内不得包含 token/thin_prd 或带凭据的 remote URL。
- 端点鉴权：若触及 API 变更，不得新增无鉴权可交付端点。
- 租户隔离：本 smoke 未触及租户数据；若触及，查询/写入必须 scope 到当前租户。
- CI seed 一致性：修改 ci.yml seed 步骤时，claude-headed 分支的 orchestrator_host/executor/payload 三元组必须与 e2e-verify.sh 的断言严格一致，且不得回归破坏 codex-headed 既有分支。

## 判定点

### 判定点 1：headed dispatch smoke 复用 vs 新建
- 候选 A：直接复用 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh`（该脚本 test#2 已覆盖 executor=claude,mode=headed 的 200/201 放行）。
- 候选 B：新建 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 并登记 `packages/quality/smoke-allowlist.txt`，与 codex 版对称。
- **建议 B**：对称性清晰，且满足"feat PR 带本 repo 约定 smoke 脚本 + 登记 allowlist"的 CI 门禁；claude 版可聚焦断言 claude-headed dispatch 路径。GAN 阶段最终裁定。

### 判定点 2：initiative_runs 归属 = 用 `initiative_id = TASK_ID` 定点查（不取最近一条），避免历史 run 冒充。
### 判定点 3：headed relay host 判定 = DB `initiative_runs.orchestrator_host` 精确等于 `skill-relay-claude-headed`。
### 判定点 4：sprint 日志可观测 = `tui.log` 存在且非空时验真（含 headed relay 信号、无 token），缺失时输出 WARN/evidence 并验 `packages/brain/src/harness-skill-relay.js` 留痕机制（`tui.log` / `appendFileSync` / `headed spawn`），wrapper 不 touch/append 该日志。

## 建议验收（当前实时真相，2026-07-13）
1. `GET /api/brain/tasks/4bb31ef5-e140-41f4-9daf-9ca4a9e51216` 返回 task，payload 含 `mode=headed`、`executor=claude`、`orchestrator=skill-relay`，且不含 `token/github_token/anthropic_token/thin_prd`。
2. DB `initiative_runs` 中 `initiative_id=4bb31ef5-e140-41f4-9daf-9ca4a9e51216` 的最新 run：`orchestrator_host='skill-relay-claude-headed'`，phase ∈ `A_planning|planning|gan|generate|evaluate|done`（`failed`/未知必须失败），started_at 非空。
3. `sprints/07130939-relay-4bb31ef5/e2e-verify.sh` 存在、可执行、exit 0，且不含 token/thin_prd/带凭据 remote URL。
4. `.github/workflows/ci.yml` 的 DoD 动态 seed 步骤能为 claude-headed 标记 seed 出与断言一致的 task/run；codex-headed 既有分支不回归。

## 备注
- 关键陷阱：ci.yml 现有 seed 硬编码 `skill-relay-codex-headed` + `executor:codex`。若本 sprint 只镜像 e2e-verify.sh 不改 ci.yml，CI 的"执行 DoD BEHAVIOR 动态命令"步骤会在 codex-headed 的 seed 数据上断言 claude-headed → 必红。generator 必须同时改 ci.yml seed 分支。
- 参考实现：codex 版 sprint `sprints/07130752-relay-a85e0582/`（contract-draft.md / contract-dod.md / e2e-verify.sh / tests/headed-smoke-contract.test.ts / task-plan.json），本 sprint 按同构镜像产出。
