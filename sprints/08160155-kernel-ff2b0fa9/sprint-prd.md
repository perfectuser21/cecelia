# Sprint PRD — Generator/Publisher 权限边界生产回归（server-owned PostgreSQL runtime resource）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（新增一条永久防退化的 Harness 角色权限边界回归）

## 背景

真实 Fleet Harness run 074d698d 已暴露 Generator 运行时权威相关缺陷（见 area invariant `generator_infrastructure_retry_identity` / `Fleet Generator Brain URL authority`）。当前 `dispatcher.js` 只为 `proposer/reviewer/evaluator` 注入 server-owned `runtime_resources`（`dispatcher.js:519-521`），Generator 角色缺一条永久回归钉死"必须获得 server-owned PostgreSQL runtime resource 且 caller false 不能降权"，以及"Generator 只产本地已提交候选、Publisher 是唯一远端发布角色"的边界。本 sprint 用先红后绿的方式补齐这条长期回归。

## Golden Path（核心场景）

系统从 [Dispatcher 组装 generator 角色 TaskBundle] → 经过 [服务端注入 server-owned runtime resource + 校验角色边界] → 到达 [RED→GREEN 单测 + 永久 smoke 接入 ratchet]

具体：
1. [触发] Dispatcher 为 role=generator 的 Harness 任务组装 TaskBundle（`execution-contract.js` taskBundleSchema）。
2. [系统处理] 服务端注入 `inputs.runtime_resources.postgres = true`（server-owned）；即使 caller 传入 `postgres: false` 也**不得降权**；Generator objective 明确"只产本地已提交候选，不得 push / 建 PR / 等 CI / merge"；Publisher objective 保持"唯一远端发布角色（exact candidate push/PR/CI/merge）"。
3. [可观测结果]
   - **先写精确 RED**：新增单测断言 generator TaskBundle `runtime_resources.postgres === true` 且 caller `postgres:false` 不降权 → 修前红、修后绿，永久留在 CI 作回归。
   - 新增可执行 smoke（`packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh`）断言上述三条边界，并**永久接入现有 smoke ratchet**（`scripts/ratchet-registry.json` 的 `smoke_pool`，direction=only_up，watermark 随新脚本上调）。
   - 全链真验（见 ## E2E 验收）：真实 Fleet Harness 的 Planner、GAN、Generator、人式 Evaluator、独立 Judge、Publisher 证据及最终 PR/CI。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- caller 显式传 `runtime_resources.postgres = false` → TaskBundle 仍必须 `postgres === true`（server-owned 不降权）。
- Generator objective 若出现 push / create pull request 语义 → smoke 判 FAIL。
- 若 Generator 被授予远端发布权（push/PR/merge）或 Publisher 不再是唯一远端发布角色 → smoke 判 FAIL。
- Brain 不可达 / 容器镜像未带 scripts 目录 → smoke 走既有降级语义（`skip_if_brain_unavailable` / ENOENT 放行），不得假绿也不得误红。

## 范围限定

**在范围内**：Generator 角色纳入 server-owned `runtime_resources.postgres` 注入 + caller false 不降权；Generator/Publisher 角色边界断言；新增 RED 回归单测；新增可执行 smoke 并接入 smoke ratchet。
**不在范围内**：不扩大任何凭据/权限范围；不新增 Publisher 实现或改其权限；不改 GAN 拓扑与角色链；不改其他角色的 runtime_resources 语义。

## 假设

- [ASSUMPTION] RED 回归单测落在 `packages/brain/src/orchestrator/__tests__/`（与既有 `dispatcher.test.js` 同层），断言消费 Dispatcher 真实组装出的 generator TaskBundle。
- [ASSUMPTION] "server-owned PostgreSQL runtime resource" = `TaskBundle.inputs.runtime_resources.postgres === true` 由 Dispatcher 服务端注入，非 caller 可覆盖。
- [ASSUMPTION] smoke ratchet 接入：现有 `smoke_pool` 以 `find scripts/smoke -name '*.sh' | wc -l` 计数；新 smoke 放在 `packages/brain/scripts/smoke/`，其与 top-level `scripts/smoke` 的计数归属按现有 wiring 约定由 Proposer/Generator 解析（Planner 不猜测具体 wiring 文件）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；以下为 PrepPRD（task 描述）显式硬约束 -->
- 安全/权限: 不扩大凭据与权限范围——Generator 仍无 push/PR/merge 授权，Publisher 权限不变（task 显式硬约束）
- 可观测: smoke 失败必须非零退出并打印失败的边界名，禁止静默假绿
- 长运行/幂等: smoke 需可在 CI 长期反复运行，不依赖一次性状态
- 超时/延迟: 待定（PrepPRD 未指定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级；与本 sprint 直接相关的子集 -->
- [Generator 重试身份] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix（来源: area）
- [Fleet Generator Brain URL 权威] 本地 Dispatcher 与 Fleet Worker 必须同时注入服务端权威 HARNESS_BRAIN_URL；Generator 仅在通用 BRAIN_URL 缺失时从该变量恢复，预检仍 fail-closed，禁止手工绕过（来源: area）
- [Planner 分支锁定] Planner workspace 必须停在服务端签发的 planner_branch；Provider 可校验但不得 checkout/switch（来源: area）
- [smoke 铁律] smoke 铁律（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；payload 无 journey_id，优雅降级 -->
- （本 line 暂无历史）

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`: generator 角色纳入 server-owned `runtime_resources.postgres` 注入（当前仅 proposer/reviewer/evaluator，见 `:519-521`）；角色 objective 边界（`:127-130`）为断言锚点
- `packages/brain/src/orchestrator/execution-contract.js`: `taskBundleSchema.runtime_resources.postgres` 契约（`:88-97`）为回归对象
- `packages/brain/src/orchestrator/__tests__/*.test.js`: 新增 RED 回归单测（generator postgres 不降权 + 角色边界）
- `packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh`: 新增可执行 smoke
- `scripts/ratchet-registry.json`: `smoke_pool`（only_up）watermark 随新 smoke 上调

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + node 单测 + 执行 smoke）。acceptance_mode=real-harness-full-chain：验收产物必须含真实 Fleet Harness 的 Planner、GAN、Generator、人式 Evaluator、独立 Judge、Publisher 六段证据及最终 PR/CI 链接。

```bash
# 占位：proposer 将填入真实脚本（local_api → node 单测 + bash smoke + curl Brain）
# 期望验收点（自然语言）：
# 1) 修前跑新 RED 单测 → 红（generator TaskBundle 缺 server-owned postgres / caller false 未被拒绝）
# 2) 修后跑同一单测 → 绿；caller postgres:false 仍得到 postgres===true
# 3) 执行 packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh → 三条边界全过、退出码 0
# 4) smoke 已被 ratchet smoke_pool 计入（only_up 不回退）
# 5) 真实 Fleet 全链证据：Planner/GAN/Generator/人式 Evaluator/独立 Judge/Publisher + 最终 PR/CI 绿
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain 后端（Dispatcher/execution-contract）与 Brain smoke，无 UI/远端 agent/engine 路径，落 autonomous。
## target_environment: local_api
## target_environment_reason: 验收为 Brain 内部纯后端——node 单测 + bash smoke + curl localhost:5221，由本地 evaluator 执行。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
