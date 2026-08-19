# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性 Map 结论 fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness `deny:impact:mapper_stale` 空转，堵漏 kernel 可靠性）

## 背景

runs f62c7e87 / d1360a48 观测到 Diff Impact Gate 出现 `deny:impact:mapper_stale` 无限重试空转。
根因：Map（`packages/brain/src/map/radius.js`）对 freshness 已给出**确定性结论**——`status:'unknown'` 且带具体 `reason_code`（如 `capability_not_in_active_projection` / `impact_anchor_missing` / `unsafe_assertion_ref`），
这些是合同锚点/能力在活跃投影里结构性缺失，**同一 base_sha 重试永远不会变好**。
但 gate（`diff-gate.js` / `structure-gate.js`）把**所有** `freshness.status !== 'fresh'` 一律折叠成通用 `mapper_stale` + `retryable: true`，
丢弃了真实 `reason_code`；下游 `harness-gates.js` 按 `retryable` 重派，于是确定性失败被当成瞬态无限重试。

本 sprint 只做一件事：让 gate **透传 Map 的真实 `reason_code`**，并为确定性结论提供 **fail-closed 非重试出口**，
瞬态结论（`status:'stale'`，一次新扫描/重投影即可修复）仍保留 `retryable: true`。

## Golden Path（核心场景）

系统从 [Impact Gate 被调用] → 经过 [读取 Map freshness] → 到达 [按确定性/瞬态分流的裁决]

具体：
1. **[触发]** Diff/Structure Impact Gate 被调用，注入的 Map 客户端返回 `freshness.status !== 'fresh'`。
2. **[系统处理·瞬态]** 当 `freshness.status === 'stale'`（如 `fact_snapshot_stale` / `projection_revision_mismatch`）→ gate 返回 `retryable: true`，且结果里的 `reason`/`reason_code` = Map 给出的**具体 `reason_code` 字面**，不再是通用 `mapper_stale`。
3. **[系统处理·确定性]** 当 `freshness.status === 'unknown'`（如 `capability_not_in_active_projection` / `impact_anchor_missing` / `unsafe_assertion_ref` / `assertion_identity_ambiguous` / `capability_assertion_coverage_missing`）→ gate **fail-closed**：`gate:'impact_unknown'`（diff）/ `gate:'blocked'`（structure），且 `retryable: false`，结果透传具体 `reason_code`。
4. **[可观测出口]** `harness-gates.js` 消费到的 receipt 携带真实 `reason_code`；确定性场景 `retryable:false` 使 harness **停止重试并如实暴露原因**，不再产生 `deny:impact:mapper_stale` 空转。

## 边界情况

- **Mapper 不可达（抛异常）**：维持现状——`mapper_unavailable` + `retryable: true`（连接性问题本就是瞬态，不在本次改动语义内）。
- **freshness 缺失/为 null**：视为不可判定，走 fail-closed 非重试出口（不得静默判绿）。
- **未知的新 reason_code**（既非典型 stale 也非典型 unknown 集合）：以 `freshness.status` 为唯一分流依据（`stale`→retryable，`unknown`/其他非 fresh→fail-closed），避免 reason_code 白名单漂移；无论如何都必须透传原始 `reason_code`。
- **无 reason_code 但 status 非 fresh**：透传 `reason` 至少为 `status` 派生值，禁止回退成通用 `mapper_stale`。

## 范围限定

**在范围内**：
- `diff-gate.js` 与 `structure-gate.js` 对 `freshness.status !== 'fresh'` 分支的裁决逻辑（reason_code 透传 + status 分流决定 retryable）。
- 结果对象/receipt 中 `reason_code`（或 `reason`）字段的透传路径至 `harness-gates.js`。

**不在范围内**：
- 修改 `map/radius.js` 的 freshness 判定规则或新增 reason_code。
- 改动 revision_mismatch / manifest_digest / projection_digest 等其它已有裁决分支。
- 改动 harness 重试计数上限 / 派发调度本身。

## 假设

- [ASSUMPTION: 瞬态 vs 确定性的机检分流线 = `freshness.status`：`stale` → 可重试；`unknown`（及其它非 fresh）→ fail-closed 非重试。此为 `radius.js` 现有语义的直接映射，无需新增枚举。]
- [ASSUMPTION: 本 sprint 不引入新的 DB 迁移或 API 契约变更，纯 gate 逻辑修复。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：第 202-208 行 `mapper_stale` 折叠点——改为透传 `reason_code` + 按 status 决定 retryable。
- `packages/brain/src/impact-contract/structure-gate.js`：第 123-124 行 `buildBlockedResult('mapper_stale', 503)` 折叠点——同上，确定性结论走非重试出口。
- `packages/brain/src/impact-contract/harness-gates.js`：确认 receipt 透传具体 `reason_code`（第 30-31 行读取路径）。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` / `structure-gate.test.js` / `harness-gates.test.js`：新增复现 + 回归断言。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + ability 双源均为空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；gate 为进程内纯逻辑，无外部延迟约束）
- 频控: 不适用
- 版本要求: 无
- 可观测: fail-closed 出口必须携带真实 `reason_code`，确定性失败必须可在 harness receipt 中被识别（不得以通用 `mapper_stale` 掩盖真因）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（step + journey_feature 源为空）；area 源仅含无关的 nightly-red 文案项，不注入；此处保留模块自带铁律 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿（来源: diff-gate.js 模块头铁律）
- [不掩盖真因] 确定性 Map 结论禁止折叠成通用 `mapper_stale`，必须透传原始 `reason_code`（来源: 本 sprint 固化）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 无 done/working ability -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（node 单测/集成 + curl localhost:5221 校验 receipt）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1) 【复现·先红】注入 mapClient stub 返回 freshness={status:'unknown', reason_code:'capability_not_in_active_projection'}，
#    改前 diff-gate/structure-gate 返回 reason='mapper_stale' 且 retryable=true —— 该断言当前应 FAIL（复现空转根因）。
# 2) 【确定性·转绿】改后同一输入返回 retryable=false，且 reason/reason_code === 'capability_not_in_active_projection'（非 'mapper_stale'）。
# 3) 【瞬态·不误伤】freshness={status:'stale', reason_code:'fact_snapshot_stale'} 时仍 retryable=true，且 reason_code 透传为 'fact_snapshot_stale'。
# 4) 【出口贯通】harness-gates receipt 中 reason_code 为具体码；确定性场景 retryable=false 传播，harness 不再重入重试（无 deny:impact:mapper_stale 空转）。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain/ 纯后端 impact-contract gate 逻辑，无 UI/agent 协议/engine 参与。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；验收为进程内 node 单测/集成 + curl localhost:5221 校验 receipt。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
