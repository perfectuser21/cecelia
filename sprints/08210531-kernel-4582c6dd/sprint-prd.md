# Sprint PRD — Diff Impact Gate 透传 reason_code 并 fail-closed 出口（终结 mapper_stale 无限重试空转）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（harness 主链去掉一个"零人 merge"路上的死循环闸）

## 背景

runs `f62c7e87` / `d1360a48` 观测到 `deny:impact:mapper_stale` 空转：Diff Impact Gate 在 Mapper
返回"非 fresh 但**确定性**"的 freshness 结论时，把它一律折叠成 `reason: 'mapper_stale', retryable: true`，
丢弃了 Mapper 已经给出的确定性 `reason_code`。orchestrator 见 `retryable: true` 就无限重派同一角色，
run 永远不终结，人审 deadline 时钟到点才死（r31 即死于此）。本轮目标：确定性 Map 结论必须 fail-closed
终结，`reason_code` 一路透传，judge 一轮 PASS、零人碰到 merge。

## Golden Path（核心场景）

系统从 [orchestrator 进入 Diff Impact Gate] → 经过 [Mapper 复算返回确定性非-fresh 结论] → 到达 [gate 带
真实 reason_code fail-closed 终结 run，不再空转]。

具体：
1. orchestrator 在 beforeGenerate/beforeEvaluate/beforeMerge 调用 Diff Impact Gate（`evaluateDiffGate`）。
2. Mapper 返回 `freshness.status !== 'fresh'` 且携带确定性 `freshness.reason_code`（Map 已确定判定、非瞬时抖动）。
3. Diff Impact Gate 不再一律 `mapper_stale/retryable:true`：**透传** `mapperResult.freshness.reason_code`
   进结果，并在 reason_code 属确定性/终态集合时给出 **`retryable: false`** 的 fail-closed blocked 出口。
4. orchestrator 收到 `retryable: false` → 归为 `impact_contract_invalid` 终态 BLOCKED，终结 run，
   不再重派（可观测结果：`deny:impact:<真实reason_code>` 出现一次即终结，无空转、无 deadline 兜底）。
5. 瞬时/真实 stale（reason_code 非确定性或缺失）仍保持 `retryable: true`，不误杀可恢复重试。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- Mapper 返回非-fresh 但 `reason_code` 缺失/未知 → 保持既有 `mapper_stale/retryable:true`（不回退可重试语义）。
- Mapper 连接失败/timeout（throw）→ 仍走 `mapper_unavailable/retryable:true`，与本次确定性折叠问题正交，不动。
- revision/manifest/projection digest mismatch 等既有 `impact_unknown` 分支不在本次范围内。

## 范围限定

**在范围内**：
- `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a（stale 折叠分支）透传 `reason_code` + 确定性 fail-closed 出口。
- 确定性 freshness reason_code 集合的定义与消费（与 orchestrator `DETERMINISTIC_IMPACT_ERROR_CODES` 语义对齐）。
- 回归测试：确定性 reason_code → `retryable:false`；未知/瞬时 → 保持 `retryable:true`。

**不在范围内**：
- structure-gate.js 的 mapper_stale 分支（除非与 diff-gate 共享确定性集合需同步，否则不动）。
- Mapper（map-client / map/radius）本身的 freshness 判定逻辑。
- orchestrator 调度/派发结构、人审 deadline 时钟机制（另有 issue）。

## 假设

- [ASSUMPTION: 确定性 freshness reason_code 是 Mapper 已产出字段（map-client freshness.reason_code），本次只透传+分类，不新增 Mapper 计算]。
- [ASSUMPTION: 确定性集合可复用/对齐 orchestrator 现有 `DETERMINISTIC_IMPACT_ERROR_CODES` 语义，terminal 条件 → 不可重试]。

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a 透传 reason_code + 确定性 fail-closed。
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js`：更新/新增 stale 分支断言（现 line 395/409 断言旧行为）。
- `packages/brain/src/impact-contract/__tests__/*diff*`/`structure-gate.test.js`：补确定性 reason_code 回归。
- （可能）`packages/brain/src/orchestrator/loop.js`：若确定性集合需在 gate 侧共享常量。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；PrepPRD 无显式 NFR；以下为本 sprint 功能性红线 -->
- 有界重试：确定性 Map 结论必须一轮终结，禁止无限重派/空转（本 sprint 核心）。
- 可观测：fail-closed 终结时 impact_gate receipt 必须留真实 `reason_code`，禁止折叠成泛化 `mapper_stale`。
- 频控/延迟/版本要求：待定（PrepPRD 未指定）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: diff-gate.js 模块契约（step/journey_feature 级 decisions 为空，area 级唯一活跃项属 capture-triage 域，与本 gate 无关，不注入）-->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked，绝不假绿（来源: diff-gate 模块契约）
- [有界终态] 确定性 Map 结论不得标记 `retryable:true`，必须 fail-closed 终结 run（来源: 本 sprint 新增铁律）
- [reason_code 透传] 已判定的 reason_code 不得被上层折叠丢弃，须一路带到 impact_gate receipt（来源: 本 sprint 新增铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths 仅返回 planned 态 ability，无 done/working 已验收行为 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql / node 单测）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node 单测 + curl localhost:5221 + psql）
# 期望验收点（自然语言）：
#  1. 单测：evaluateDiffGate 遇确定性 freshness.reason_code → 返回 { gate:'impact_unknown', reason_code:<原值>, retryable:false }
#  2. 单测：evaluateDiffGate 遇未知/瞬时 stale → 仍返回 { reason:'mapper_stale', retryable:true }（不误杀）
#  3. orchestrator loop：确定性 mapper_stale → 归 impact_contract_invalid 终态 BLOCKED，不再重派（无空转）
#  4. 回归：impact_gate receipt 中 reason 为真实 reason_code，非泛化 'mapper_stale'
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 orchestrator + impact-contract 逻辑，无 UI/agent 协议/engine 触点。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api，Brain 内部 gate 逻辑，本地 evaluator 走 node 单测 + curl localhost:5221 + psql。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
