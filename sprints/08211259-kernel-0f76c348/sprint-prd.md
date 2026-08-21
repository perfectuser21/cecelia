# Sprint PRD — Diff Impact Gate 透传确定性 reason_code + fail-closed 出口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（harness 零人碰 merge，堵住 mapper_stale 空转黑洞）

## 背景

runs f62c7e87 / d1360a48 观测到 `deny:impact:mapper_stale` 无限重试空转。根因：
`evaluateDiffGate`（`packages/brain/src/impact-contract/diff-gate.js` 步骤 3a）在 Mapper
`freshness.status !== 'fresh'` 时一律折叠成 `{ reason: 'mapper_stale', retryable: true }`，
把 Mapper 已经给出的**确定性结论**（`freshness.reason_code`，如 `deny:impact:*`）吞掉，
导致确定性拒绝被当成瞬时不新鲜而无限重试。修复目标：确定性 Map 结论必须透传 reason_code
并走 fail-closed 终态出口（不可重试），只有真正瞬时不可达才保留 mapper_stale 重试。

## Golden Path（核心场景）

系统从 [Diff Impact Gate 复算影响半径] → 经过 [识别 Mapper 结论是否确定性] → 到达 [终态裁决，不空转]

具体：
1. [触发条件] 一个 harness 任务编码完成，进入 Diff Impact Gate；Mapper 返回
   `freshness.status = 'stale'|'unknown'` 且携带确定性 `freshness.reason_code`（如 `deny:impact:...`）
2. [系统处理] Gate 检测到该 reason_code 是确定性终局结论 → 透传到 verdict 的 `reason_code`，
   并以 fail-closed 终态出口收尾（`retryable: false`），不再折叠成通用 `mapper_stale`
3. [可观测结果] gate verdict 携带原始 `reason_code`（如 `deny:impact:...`），`retryable: false`；
   任务落终态，不再对同一确定性结论无限重试
4. [反向保留] 若 Mapper 仅是真正瞬时不新鲜（无确定性 reason_code）→ 仍返回 `mapper_stale` +
   `retryable: true`（原有重试语义不回退）

## 边界情况

- Mapper `freshness.status` 非 fresh 但 `reason_code` 为空/null → 归为瞬时不可达，保留 retryable 重试
- `reason_code` 存在但非确定性拒绝类 → 归类规则需明确，默认 fail-closed（宁可停不空转）
- DB / Mapper 完全不可达（抛错）→ 维持既有 `db_unavailable` / `mapper_unavailable` retryable 出口

## 范围限定

**在范围内**：`diff-gate.js` 步骤 3a mapper_stale 分支的 reason_code 透传与 fail-closed 出口分流；对应回归测试。
**不在范围内**：revision/digest mismatch 各分支语义；compareImpactContract 对账逻辑；Mapper 本身产出 reason_code 的实现。

## 假设

- [ASSUMPTION: 确定性结论的判据 = `mapperResult.freshness.reason_code` 非空且形如 `deny:*`/终局码；具体白名单由 proposer 读 map-client 契约锚定]
- [ASSUMPTION: fail-closed 出口沿用既有 `gate: 'impact_unknown'` 语义但置 `retryable: false` 并透传 `reason_code`；不新增 gate 枚举]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3a 非 fresh 分支拆分为「确定性→透传+fail-closed」与「瞬时→retryable」
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增复现 mapper_stale 空转的 failing 回归测试

## NFR 约束

<!-- 来源: decisions 表 category=nfr 双源均空；以下为本 task issue_ref 根因派生的 [ASSUMPTION] -->
- 有界重试: 确定性 Map 结论不得进入无限重试；`retryable: true` 只允许真正瞬时不可达 — [ASSUMPTION]
- 可观测: gate verdict 必须携带原始 `reason_code`，确定性拒绝不得被吞成通用 `mapper_stale` — [ASSUMPTION]
- 超时/频控/版本要求: 待定（PrepPRD / decisions 未指定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 空；area 88 条中仅列相关铁律 -->
- [fail-closed] Diff Impact Gate 任何不可判定情形均 fail-closed，绝不假绿放行（来源: journey_feature，SSOT diff-gate.js 头部原则）
- [租户隔离] 记忆/数据/测试按租户隔离，测试默认多租户（来源: area）
<!-- area 层另有 86 条 capture-triage 学习型 invariant，与本 sprint（impact-gate reason_code 透传）无交集，未注入 -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 已完成 ability 的 golden_path；查得 ability 均为 planned 态 -->
- （本 line 暂无已验收 ability 历史）

## E2E 验收

> Planner 初稿占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 按 local_api 填入真实脚本（node 单测 evaluateDiffGate + curl localhost:5221 观测任务不空转）
# 期望验收点（自然语言）：
#   构造 Mapper 返回 freshness.status='stale' 且 freshness.reason_code='deny:impact:...' 的场景，
#   evaluateDiffGate 结果 reason_code 透传为该确定性码、retryable=false；
#   对照组（reason_code 为空的瞬时 stale）仍 reason='mapper_stale' 且 retryable=true。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落 packages/brain/ 纯后端 impact-contract 逻辑，无 UI / 远端 agent / engine 介入
## target_environment: local_api
## target_environment_reason: Brain 内部 impact-gate 逻辑，本地 evaluator 跑 node 单测 + curl localhost:5221 验证
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
