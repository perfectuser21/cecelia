# Learning — F1 Capability 可信认证闭环（Mapper fail-closed 认证闸）

## 背景

Mapper 真实读路径 `loadMapNodeStates`（`packages/brain/src/lib/map-state-resolver.js`）此前把
Capability 投影为 green 只需一条 PASS receipt + revision 匹配，缺「认证前提」闸——无 signed GP contract、
receipt 未绑定 GP/Impact identity、step-link 未绑定 Feature/Assertion 时仍显绿（假绿）。

## 改动

1. **读闸（`resolveEvidenceState` + `loadMapNodeStates`）**：新增可选 `certification` 上下文，在 revision 校验后、
   verdict 判定前施加四前提 fail-closed 闸，缺任一返回 `unknown` + 专属 reason_code：
   `step_link_unbound` / `gp_contract_unsigned` / `receipt_gp_contract_unbound` / `receipt_impact_contract_unbound`
   （陈旧 SHA 复用既有 `receipt_revision_mismatch`）。认证上下文来自实时表
   `journey_step_links` + `golden_paths` + `golden_path_contract_versions`（status='signed'），
   非投影快照——step-link 解绑 / 合同撤签能被查询时现算捕获。
2. **reason 冒泡（`aggregateMapStates`）**：red/unknown 分支改为冒泡失败子节点的具体 reason_code
   （子节点无 reason_code 时回落 `child_red`/`child_unknown`，保持既有聚合契约与单测不变），
   使认证闸原因码从 assertion 一路带到 capability 节点。
3. **写闸（`persistTrustedEvaluatorReceipts`）**：INSERT 改为 CTE，从 `journey_step_links → golden_paths →
   golden_path_contract_versions(signed)` 解析并落 `gp_contract_id`/`gp_contract_hash`；无 signed 合同时
   `signed_gp` 为空 → 不落 receipt → 抛 evidence 错误（fail-closed，不静默落无绑定 PASS receipt）。
   CTE 单查询保留原 db.query 调用序，既有 mock 单测零改动。

## 坑

- **migration 409 约束链**：`journey_assertion_receipts` 绑定 `impact_contract_id` 时，FK 要求真实
  `harness_impact_contracts` 行，check 约束要求 `harness_attempt_id` 同时非空。回归 fixture
  `map-state-resolver.integration.test.js` 补 signed GP contract 之外，还须真实播种
  `tasks → initiative_runs → harness_impact_contracts / harness_attempts` 链方能满足绿态 receipt 绑定。
- **聚合 reason 冒泡不能改 green 分支**：`aggregateMapStates` 绿聚合仍返回 `children_green`，否则
  `map-state-resolver.test.js` 单测 line 134/157 断言 children_green 会破。
