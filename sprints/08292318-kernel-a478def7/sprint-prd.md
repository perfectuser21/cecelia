# Sprint PRD — 合同重开后主链派全新 generator，根除 WORKSPACE_RESOLUTION_FAILED 必死

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消化 r73 台账 P1：合同重开路径 100% 必死的确定性缺陷）

## 背景

r73 实证（run da3aa553）：generator 报 CONTRACT_SELF_CONTRADICTION 触发合同重开 GAN（设计内自愈），
第二版合同批准后 derive 见 `proposeBranchRn>0` 且无 PR，主链把 no_pr 路由到 `spawn:generator-fix`。
但 fix 需要的源 workspace 属**第一版已作废合同** → prepare 报 `workspace_source_attempt_unavailable`
→ `assembly_fault:WORKSPACE_RESOLUTION_FAILED` 终局。合同重开路径确定性必死。
根治方向：合同重开后新合同批准的 no_pr 场景，应从冻结基线**重写**（全新 generator），而非修一个不存在的旧候选。

## Golden Path（核心场景）

系统从 [合同重开后新合同批准 + no_pr] → 经过 [derive 识别 REOPEN_GAN_CONTRACT 历史] → 到达 [派全新 generator]

具体：
1. 触发条件：同一 run 的 decisionLog 中存在 `REOPEN_GAN_CONTRACT` 行（合同重开发生过），新合同已批准，
   derive 观测到 `proposeBranchRn>0` 且无 PR/候选（no_pr）。
2. 系统处理：主链路由判定「本 no_pr 处于合同重开纪元、旧候选 workspace 已作废不可修」，
   派 `spawn:generator`（全新 generator，从冻结基线重写），`reason` 标注 `contract_reopened_fresh_generator`；
   **不**派 `spawn:generator-fix`。
3. 可观测结果：路由结果 `action = spawn:generator`、`reason = contract_reopened_fresh_generator`，
   下游不再触达 generator-fix → prepare 不再撞 `workspace_source_attempt_unavailable` →
   不再终局于 `assembly_fault:WORKSPACE_RESOLUTION_FAILED`。

## 边界情况

- **有界重发**：同 run 合同重开后全新 generator 已派过、又走到 no_pr → 不再无限重发全新 generator，
  按既有 fix 计数语义继续（沿用 fix_round 上限）。
- **负向不变**：无 REOPEN_GAN_CONTRACT 历史的 no_pr → 语义不变，仍 fix 路由。
- **纪元隔离**：合同重开**之前**的产出/历史不影响本轮判定（只看重开后纪元）。

## 范围限定

**在范围内**：`packages/brain/src/orchestrator/derive.js` 中 no_pr 分支的路由判定（纯函数）；对应 RED→GREEN 测试。
**不在范围内**：
- 不动 workspace 回收策略（worker 侧另表）。
- 不动 CONTRACT_SELF_CONTRADICTION 的重开触发本身。

## 假设

- [ASSUMPTION: 「合同重开后」由 decisionLog 中 `REOPEN_GAN_CONTRACT` 行存在判定；「全新 generator 已派过」由重开纪元起点之后是否已出现 `spawn:generator` 判定，具体锚点由 Proposer/Generator 读 derive.js 现有 helper（sortedLogRows / 纪元起点 hop）实现。]
- [ASSUMPTION: derive.js 为纯函数、无 I/O，测试可确定性重放 r73 观测快照。]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：no_pr 分支（约 deriveTask L1338–1368）新增合同重开纪元识别 + 全新 generator 路由。
- `tests/gp/f1/step3-contract-reopen-fresh-generator.test.js`（新建，文件名避让 main 已有同族 `step3-generator-fix-after-publish` / `step3-seal-reject-reopens-gan` / `step3-artifacts-missing-reopen`）：RED 复刻 r73（重开后现状 fix 路由 = 红 / 修后全新 generator = 绿），真 import derive.js，禁 mock 被改的边。
- 行为变更冲突的既有 no_pr / generator-fix 回归测试：如与新路由冲突，一并 claim 更新。
- 版本 bump 四处（check-version-sync.sh 校验）：`packages/brain/package.json` 等四处同步。
- `sprints/08292318-kernel-a478def7/DoD.md` 与 `sprints/08292318-kernel-a478def7/**`（合同四件套）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step 源 0 条 / feature 源 0 条），PrepPRD 显式约束优先 -->
- 纯函数可重放：derive 路由为纯函数，同一观测快照必得同一路由结果（PrepPRD 显式要求）。
- RED 先行：先写能复刻 r73 场景的 failing test，修后永久保留为回归（PrepPRD 显式要求，硬规则 #19/#20）。
- Green commit message 用 `fix(` 前缀（PrepPRD 显式要求）。
- 超时/延迟：待定（PrepPRD 未指定）。
- 频控：待定（PrepPRD 未指定）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 源 0 条） -->
- [generator-infra-retry-identity] Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator（来源: area）
- [fleet-brain-url] 本地 Dispatcher 与 Fleet Worker 必须同时注入服务端权威 HARNESS_BRAIN_URL；Generator 仅在通用 BRAIN_URL（来源: area）
- [planner-role-branch] Planner workspace 必须停在服务端签发的 planner_branch，Provider 内不得自行 checkout/switch（来源: area）
- [kernel-validation-clock] 保留 validation_clock_required 默认 fail-closed，仅 gear=hotfix 且 payload 显式 pr_url 例外（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths，done/working ability 0 条 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=local_api 产出，写进 contract-draft.md 的 `## E2E 验收`。

```bash
# 占位：proposer 将填入真实脚本（local_api → node 直跑 vitest 真 import derive.js）
# 期望验收点（自然语言）：
#  1) 喂入复刻 r73 的观测快照（含 REOPEN_GAN_CONTRACT 行 + proposeBranchRn>0 + no_pr）→
#     derive 返回 action=spawn:generator、reason=contract_reopened_fresh_generator（不含 generator-fix）。
#  2) 有界：重开后已派全新 generator 再遇 no_pr → 回落既有 fix 计数语义（非无限重发 generator）。
#  3) 负向：无 REOPEN_GAN_CONTRACT 历史的 no_pr → 仍走 fix 路由（语义不变）。
#  4) RED 基线：修改前用例 1 断言必红（现状 fix 路由）。
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端 derive 路由，无 UI/远端 agent/engine hooks，命中 brain→autonomous。
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部纯函数，本地 evaluator 直跑 vitest 真 import derive.js（localhost:5221 侧无需真实 E2E）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
