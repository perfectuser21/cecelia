# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口（不再把确定性 Map 结论折叠成 mapper_stale 空转）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 一类无限重试空转，提升 F1 造完真验闭环可靠性）

## 背景

runs f62c7e87 / d1360a48 观测到 `deny:impact:mapper_stale` 空转：Diff Impact Gate 在 Mapper 已给出**确定性结论**（freshness.status = stale/unknown 且带明确 reason_code，如 `impact_anchor_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref`）时，把它一律折叠成硬编码 `reason: 'mapper_stale', retryable: true`，丢弃了 Mapper 真实的 `reason_code`。`orchestrator/loop.js` 据此写 `gateVerdict = deny:impact:mapper_stale` 且 `retryable:true`，任务被无限重试——确定性结论本应 fail-closed 终止，却被当成瞬态可重试，导致空转。r39 目标：到 merge fence 一次通过。

## Golden Path（核心场景）

系统（harness orchestrator loop）从 [Gate 触发] → 经过 [Mapper 确定性结论] → 到达 [fail-closed 终止，不再空转]

具体：
1. [触发条件] loop.js 在 beforeGenerate / beforeEvaluate / beforeMerge 调用 Diff Impact Gate（`evaluateDiffGate`），Mapper 对本次变更复算影响半径，返回 `freshness.status ≠ 'fresh'` 且带确定性 `reason_code`（如 `impact_anchor_missing`）。
2. [系统处理] Gate 不再把结果折叠成 `mapper_stale`：**透传** Mapper 的 `freshness.reason_code` 作为 gate `reason` / `reason_code`；并按该 reason_code 是否为确定性结论决定 `retryable`——确定性结论 → `retryable: false`（fail-closed 出口），瞬态结论（如 `fact_snapshot_stale` 快照追赶中）→ 保持 `retryable: true`。
3. [可观测结果] loop.js 写 `gateVerdict = deny:impact:<真实 reason_code>`（不再是 `deny:impact:mapper_stale`）；确定性结论下任务走 blocked / fail-closed 终止，重试计数不再无限增长，空转消失。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- Mapper 不可达（抛错）→ 维持既有 `mapper_unavailable` + `retryable:true`（本 sprint 不改）。
- `freshness.reason_code` 缺失/为 null 但 status≠fresh → 保守回退为 `mapper_stale` 且 `retryable:true`（不假绿、不误判终止）。
- 瞬态 reason_code（快照/投影追赶类）必须仍 `retryable:true`，避免把可自愈情形误 fail-closed。
- 同一确定性结论重复进入 Gate → 判定确定性（幂等），不得在 retryable 与否之间震荡。
- 兄弟门 `structure-gate.js` 同款折叠缺陷需一并修（否则换条路径仍空转）。

## 范围限定

**在范围内**：
- `packages/brain/src/impact-contract/diff-gate.js` step 3a：透传 `freshness.reason_code` + 确定性 reason_code → `retryable:false` fail-closed 出口。
- `packages/brain/src/impact-contract/structure-gate.js` 同款 `mapper_stale` 折叠点（line ~124）同步修复。
- 确定性 reason_code 白名单（与 loop.js `DETERMINISTIC_IMPACT_ERROR_CODES` 语义对齐，覆盖 radius.js 产出的确定性 freshness reason_code）。
- 回归测试：复现 f62c7e87/d1360a48 空转的 failing test（先红后绿，永久保留）。

**不在范围内**：
- Mapper（`map/radius.js`）产出逻辑本身、freshness 判定规则。
- loop.js 重试调度/退避策略改造（仅消费透传后的 reason_code + retryable，不改循环结构）。
- 合同 schema、gap ledger、drift 仲裁逻辑。

## 假设

- [ASSUMPTION: 确定性 vs 瞬态的划分依据 Mapper `freshness.reason_code` 语义——投影/事实快照追赶类（`fact_snapshot_stale` 等）为瞬态可重试；锚点/覆盖/引用类（`impact_anchor_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous` / `capability_assertion_coverage_missing`）为确定性 fail-closed。最终白名单由 Proposer 对齐 radius.js 与 loop.js 后锁定。]
- [ASSUMPTION: 透传字段沿用现有 `reason` / `reason_code` 出口字段，不新增消费方无法识别的字段。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：step 3a 折叠点改为透传 reason_code + 确定性 fail-closed 出口。
- `packages/brain/src/impact-contract/structure-gate.js`：`buildBlockedResult('mapper_stale', 503)` 折叠点同步修复。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：新增确定性结论透传 + fail-closed 回归用例。
- `packages/brain/src/impact-contract/__tests__/structure-gate.test.js`：同款回归用例。
- （可能）确定性 reason_code 常量的定义/共享位置（避免 diff-gate/structure-gate/loop 三处漂移）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双查为空），PrepPRD 未提供显式 NFR -->
- 确定性/幂等: 同一 Mapper 结论多次进 Gate，reason_code 与 retryable 必须稳定，不得震荡（消除空转的核心 NFR）。
- fail-closed: 任何不可判定情形绝不假绿；确定性结论必须终止而非无限重试，瞬态结论方可重试。
- 超时/延迟: 待定（PrepPRD 未指定）
- 可观测: gate 裁决必须透传真实 reason_code，供 loop.js 写入 `deny:impact:<reason_code>` 可追因。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature/area 三源；本 journey 三源均无适配铁律 -->
- （本 line 暂无历史 invariant；沿用 gate 设计铁律：Mapper 任何不可判定情形 fail-closed，绝不假绿）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 无 done/working ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位 + 期望验收点自然语言描述；可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node 单测 + curl localhost:5221）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1) 构造 mapClient 返回 { freshness: { status:'unknown', reason_code:'impact_anchor_missing' }, ... }，
#    调用 evaluateDiffGate → 结果 reason/reason_code == 'impact_anchor_missing'（非 'mapper_stale'）且 retryable == false。
# 2) 构造瞬态结论 { freshness:{ status:'stale', reason_code:'fact_snapshot_stale' } } →
#    reason_code 透传为 'fact_snapshot_stale' 且 retryable == true（仍可重试）。
# 3) reason_code 缺失/null 且 status≠fresh → 回退 mapper_stale + retryable:true（保守，不假绿）。
# 4) structure-gate 同款三条断言。
# 5) 复现 f62c7e87/d1360a48：先跑 failing test 证明旧行为空转（折叠 mapper_stale），修复后转绿并永久保留。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 impact-contract gate 逻辑，无 UI / 无远端 agent 协议，命中 brain → autonomous。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；验收为 Brain 内部 node 单测 + curl localhost:5221，本地 evaluator 执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
