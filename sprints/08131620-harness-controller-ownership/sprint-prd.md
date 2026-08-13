# Sprint PRD — Harness 双运行时 Controller ownership 与 GP identity 收口

## OKR 对齐

- **对应 KR**：KR-Cecelia基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（关闭两条 harness 生产阻断，双运行时终态权归一）

## 背景

生产两刀同源于"双代运行时争夺 initiative_runs 终态权"：
- 刀一：task ad9f3a01 的 run 61b34e3b CI fail 后派 generator-fix，dispatcher 因 payload 带通用 journey_id 抛 `GP_CONTRACT_IDENTITY_INVALID` / `TASK_BUNDLE_ASSEMBLY_FAILED`——journey-only 任务被 GP 合同身份校验误判为不完整合同。
- 刀二：task b858a8bb 的 one-session relay 容器健康运行、Reviewer running，但 legacy run 59a41559 由 harness-skill-relay.js 直接 INSERT v2 run，`controller_session_id`/lease 均 NULL，5 分钟后 `reconcileOwnerlessKernelRuns` 以 `ownerless_kernel_run_recovered:no_controller_ownership` 误杀活着的 relay。

## Golden Path（核心场景）

系统从 [CI fail 触发修复 / relay 拉起] → 经过 [组包与建 run] → 到达 [派发成功且 run 活过巡检周期]

具体：
1. dispatcher 收到 journey-only 的 `spawn:generator-fix`（payload 含 journey_id、无版本化 GP 身份字段）→ gpContractIdentity 触发谓词只看版本化 GP 身份字段 → 判为"无 GP 合同"返回 null → TaskBundle 正常组包派发，无 `GP_CONTRACT_IDENTITY_INVALID` / `TASK_BUNDLE_ASSEMBLY_FAILED`。
2. legacy one-session relay（含 claude/codex/grok fallback、xian、headed）创建 initiative_runs 时，统一经 createKernelRun 或等价事务在同一创建事务写 `controller_session_id` + `controller_lease_expires_at`。
3. relay 容器健康运行、lease 有效；超过一个 `reconcileOwnerlessKernelRuns` 巡检周期（>5 分钟）后 run 仍为非终态（active），未被 `no_controller_ownership` 终态化。

出口：journey-only generator-fix 正常派发；legacy relay run 带可续租 Controller ownership，活过一个巡检周期。

## 边界情况

- 部分 GP 身份（有 gp_contract_id 但缺 hash/version 等）→ 继续 fail-closed，照旧抛 `GP_CONTRACT_IDENTITY_INVALID`。
- 完整版本化 GP 身份 → 继续透传，返回 frozen contract（行为不变）。
- grok 额度撞墙 fallback claude 分支落 run 时同样带 ownership（不得漏写）。
- relay 容器真死亡 / lease 真过期 → scanner 仍正常回收，不得因本次改动放跑真无主 run。

## 范围限定

**在范围内**：
- `gpContractIdentity` 触发谓词：从触发字段集中剔除通用 `journey_id`，仅版本化 GP 身份字段（gp_contract_id/version/hash/golden_path_id/step_id）触发校验。
- `harness-skill-relay.js` 四处直写 `INSERT INTO initiative_runs`（main session / grok fallback / xian bridge / headed tmux）收敛为带 controller ownership 的创建（复用 createKernelRun 或收敛为单一创建函数），并具备续租/活容器语义。

**不在范围内**：
- kernel-v1 主派发路径（已经 createKernelRun 带 ownership，不改）。
- GP 合同 UUID/SHA 校验规则本身、已废弃的 LangGraph 图链路。
- 新建独立续租守护进程（复用既有 controller lease + watchdog 续租机制）。

## 假设

- [ASSUMPTION: createKernelRun 是既有 canonical 创建函数（deps.createKernelRun 可注入），legacy relay 四分支可复用其 controller_session_id + lease 同事务落库能力]
- [ASSUMPTION: "续租/活容器语义"由既有 controller lease + watchdog 续租承载，本 sprint 只需保证 legacy run 落库即带非空 lease，不新造续租器]
- [ASSUMPTION: 巡检周期 5 分钟以生产证据（reconcileOwnerlessKernelRuns 约 5min 误杀）为准]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`：gpContractIdentity 触发谓词剔除 journey_id
- `packages/brain/src/harness-skill-relay.js`：四处直写 INSERT 收敛为带 ownership 的创建 + 续租语义
- `packages/brain/src/orchestrator/kernel-run-store.js`：如需暴露/复用 createKernelRun 给 legacy 分支
- `packages/brain/src/__tests__/relay-runs-canonical-create.test.js`：四分支 ownership 回归（含 grok fallback / xian / headed）
- `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js`：真实 PG relay run 活过巡检周期
- dispatcher gpContractIdentity journey-only / 部分身份 / 完整身份 三态单测

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl + psql + vitest PG integration。

```bash
# 占位：proposer 将填入 local_api 脚本（vitest PG integration + psql 断言）
# 期望验收点（自然语言）：
# 1) 真实 generator-fix TaskBundle（journey-only payload）经 dispatcher 组包成功，无 GP_CONTRACT_IDENTITY_INVALID / TASK_BUNDLE_ASSEMBLY_FAILED
# 2) 部分 GP 身份仍抛 GP_CONTRACT_IDENTITY_INVALID；完整 GP 身份仍返回 frozen contract
# 3) 真实 one-session relay 创建 initiative_runs：psql 查该 v2 run，controller_session_id 与 controller_lease_expires_at 均非空
# 4) 真实 relay 运行超过一个巡检周期（>5min）后跑 reconcileOwnerlessKernelRuns，psql 确认 run phase 仍非 done/failed，未被 no_controller_ownership 终态化
# 5) 对照：故意造无 ownership 的 v2 run，reconcile 仍能正常终态化（回收能力未被削弱）
```

## NFR 约束

<!-- 来源: decisions category=nfr（本任务 step/feature 级均空）+ PrepPRD 显式值优先 -->
- 超时/延迟: reconcileOwnerlessKernelRuns 巡检周期约 5 分钟；relay run 必须活过一个完整周期（PrepPRD 生产证据）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: orchestrator_version='v2' active run 必须携带可续租 Controller ownership（PrepPRD 法则）
- 可观测: 误杀/回收路径 failure_reason 必须结构化落库（no_controller_ownership vs controller_lease_expired 可区分）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 级本任务为空）；journey_id/ability_id 为 null，无 line 级历史 -->
- [终态权归一] 两代运行时不得争夺 initiative_runs 终态权；所有 v2 active run 必须有可续租的 Controller ownership（来源: PrepPRD 法则）
- [local_api验证] judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁，此类任务需在合同显式声明验证方式（来源: area）
- [台账不入库] controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo（来源: area）
- [exit语义实跑] 合同验证命令必须实跑确认 exit code 语义，vitest 对 include 范围外路径绿态也退出 0（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本任务 journey_id 为 null（非路径 C journey 点火），无 line 级历史 -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端改动（dispatcher 组包谓词 + relay 建 run 事务 + 无主 run 巡检），无 UI/远端 agent 协议本体变更。
## target_environment: local_api
## target_environment_reason: 验收全走本地 evaluator——vitest PG integration + psql localhost 断言 run 生命周期，无 Windows/微信/前端面。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
