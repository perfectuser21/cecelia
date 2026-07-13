# Sprint PRD — claude-headed-smoke 回归链路固化

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：不扩展功能，把 codex-headed（#3827）已验证的 headed relay 回归链路，同构镜像到 claude-headed，并补齐 CI DoD seed 分支缺口。

## 背景

本 sprint 是已合并 #3827「headed smoke regression wrapper」（codex-headed，sprint `sprints/07130752-relay-a85e0582`）的**同构镜像版**：executor 从 `codex` 换成 `claude`，orchestrator_host 从 `skill-relay-codex-headed` 换成 `skill-relay-claude-headed`。目标是验证 `executor=claude + mode=headed + orchestrator=skill-relay` 的 `harness_initiative` 已被 Brain 接收、派发，具备可观测 run 状态，并把验收固化为 CI 可持续回归的 wrapper。

## Golden Path（核心场景）

系统从 claude-headed task 进入 → 读取 Brain task 与 initiative_run 状态 → 确认 headed relay 关键观测信号完整 → CI 的 DoD 动态 seed 步骤能为 claude-headed 分支 seed 出匹配数据 → 输出可被后续 proposer/evaluator 消费的回归验收边界。

具体：
1. 触发条件：task `4bb31ef5-e140-41f4-9daf-9ca4a9e51216` 存在，payload 字面包含 `mode=headed`、`executor=claude`、`orchestrator=skill-relay`。
2. 系统处理：Brain run 进入 harness 阶段，DB `initiative_runs` 记录 `orchestrator_host='skill-relay-claude-headed'`；CI 的 DoD 动态验证 seed 步骤按 claude-headed 标记 seed 出匹配 `orchestrator_host`+`executor:claude` 的 task/run（不使用 codex-headed 的硬编码 seed）。
3. 可观测结果：task payload、initiative_runs 的 headed relay host/phase、以及 sprint_dir/tui.log 约定可被本机 API/DB 证据验证；`e2e-verify.sh` 可在本地与 CI 重复执行且 exit 0。

## 边界情况

- 已存在 headed tmux session 或 initiative_run 时，只验证现有状态，不重复 spawn，不误杀会话。
- Brain API 或 DB 暂不可读时，不能标 done，只能记录缺失证据。
- `tui.log` 缺失时输出 WARN/evidence，转而验 `packages/brain/src/harness-skill-relay.js` 的留痕机制（`tui.log`/`appendFileSync`/`headed spawn`），wrapper 不得 touch/append 该日志。
- CI seed 步骤修改后，codex-headed 既有分支的 seed/断言不得回归破坏。

## 范围限定

**在范围内**：
- 新增 `sprints/07130939-relay-4bb31ef5/e2e-verify.sh`，定点验证当前 claude-headed task（`initiative_id=TASK_ID` 精确查，不取最近一条）。
- 新增 `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` 并登记 `packages/quality/smoke-allowlist.txt`（与 codex 版对称，GAN 阶段最终裁定是否复用 vs 新建）。
- 修改 `.github/workflows/ci.yml` 的 DoD 动态验证 seed 步骤：新增 claude-headed 分支，seed `orchestrator_host='skill-relay-claude-headed'` + `payload.executor='claude'` 的 task/run，与 codex-headed 分支并存不冲突。
- 更新 DoD.md 记录本 sprint 的 claude-headed relay DoD。

**不在范围内**：不扩展业务功能，不改 dashboard/UI，不改 migrations，不跨 repo 生产 promote，不改动 codex-headed 既有 smoke/wrapper 语义（只做加法）。

## 假设

- [ASSUMPTION: 当前 task payload 无 `thin_prd` 字段，本 PRD 以 PrepPRD 的 `claude-headed-smoke` 三元组（mode/executor/orchestrator）与参考实现 `sprints/07130752-relay-a85e0582/` 作为 scope 锚定。]
- [ASSUMPTION: `orchestrator_host='skill-relay-claude-headed'` 以 DB `initiative_runs` 为最终验收源，Brain runs API 若未返回该字段不替代 DB 验收。]
- [ASSUMPTION: `ability_id`/`journey_feature` 均未挂载于本 task，无 step/feature 级 NFR、invariant、累积 FR 可读，仅 area 级铁律适用。]

## 预期受影响文件

- `sprints/07130939-relay-4bb31ef5/e2e-verify.sh`: 新增，claude-headed 定点回归验证脚本。
- `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`: 新增（判定点，GAN 裁定），与 codex 版对称的 dispatch smoke。
- `packages/quality/smoke-allowlist.txt`: 登记新 smoke 脚本。
- `.github/workflows/ci.yml`: 新增 claude-headed DoD 动态 seed 分支，不破坏 codex-headed 既有分支。
- `DoD.md`: 记录本 sprint claude-headed relay DoD。

## NFR 约束

- 可观测：必须能通过 Brain API/DB 看到 task 与 initiative_runs 状态。
- 安全：不得把 GitHub token、Claude/Anthropic 凭据、`thin_prd` 全文中的敏感内容写入报告、日志或 `e2e-verify.sh`。
- 幂等：只读验证，重跑幂等；不重复 spawn，不误杀现有 headed session。
- 本地验证：所有 done 结论必须基于本机真实命令/API/DB 证据。
- 最小变更：视为 smoke/CI 回归补齐，不生成无关代码改动。
- CI 回归宿主：新增 `e2e-verify.sh` 与 smoke 脚本必须被 CI（smoke-glob / DoD 动态验证 / e2e paths）持续收集，不能"只活一次"。
- CI seed 一致性：修改 `ci.yml` seed 步骤时，claude-headed 分支的 `orchestrator_host`/`executor`/`payload` 三元组必须与 `e2e-verify.sh` 断言严格一致，且不得回归破坏 codex-headed 既有分支。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [单slot串行] 一个 slot/会话内严格串行执行任务；需要并行时用多个 slot/独立 session（来源: area）
- [禁写死假设] 端口、路径、host、凭据目录等优先读取 payload/env/当前工作区，缺失时保守推断并注明来源（来源: area）
- [真验才done] 未实际验证 Brain API/DB 信号前不能标 done；接缝断言必须真机验证（来源: area）
- [测试多租户] 单元/E2E 测试默认种≥2个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容/完整敏感 prompt 不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；若触及 API 变更，不得新增无鉴权可交付端点（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；若本 smoke 触及租户数据须遵守（来源: area）
- [服务判活双信号] 服务"该活着"的判定用 launchctl 状态 + 端口监听双信号，单看任一会漏判（来源: area）
- [常驻服务接线] 新增常驻宿主服务时必须同步加进 `packages/brain/src/launchd-patrol.js` manifest（来源: area）
- [smoke一次带齐] feat+brain/src PR 开 PR 前一次带齐 smoke.sh + smoke-allowlist 登记，不等 CI 两连红才补（来源: area）
- [新task_type接线七点] 新 task_type 接线需覆盖约束/task-router 四表/EXECUTOR_KIND_FOR/executor dispatch 分支/executor override 排除/relay loadSkill 映射/dispatcher 三防线（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史；`journeys/{journey_id}/golden-paths` 查询为空数组，ability_id 未挂载）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本（curl + psql）。
# 期望验收点（自然语言）：
# 1. GET /api/brain/tasks/4bb31ef5-e140-41f4-9daf-9ca4a9e51216 返回 task，payload 含
#    mode=headed、executor=claude、orchestrator=skill-relay，且不含 token/github_token/anthropic_token/thin_prd。
# 2. DB initiative_runs 中 initiative_id=4bb31ef5-e140-41f4-9daf-9ca4a9e51216 的最新 run：
#    orchestrator_host='skill-relay-claude-headed'，phase ∈ A_planning|planning|gan|generate|evaluate|done
#    （failed/未知必须失败），started_at 非空。
# 3. sprints/07130939-relay-4bb31ef5/e2e-verify.sh 存在、可执行、exit 0，且不含 token/thin_prd/带凭据 remote URL。
# 4. .github/workflows/ci.yml 的 DoD 动态 seed 步骤能为 claude-headed 标记 seed 出与断言一致的 task/run；
#    codex-headed 既有分支不回归。
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain/harness 后端派发链路 smoke，无用户可见 UI 交互，无 engine pipeline 变更；无路径线索命中 dashboard/agent_remote/engine，默认 autonomous。
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221、PostgreSQL initiative_runs 查询与本机 sprint 日志，无需浏览器或远端 runner。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: （未提供，task.ability_id 为空，无 golden_path 步骤锚点可取）
