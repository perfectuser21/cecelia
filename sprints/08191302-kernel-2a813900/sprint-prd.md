# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口，消除 mapper_stale 无限重试

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（harness kernel 全链去除一处死循环空转，publish→merge 可达）

## 背景

kernel harness 全链验证 r21：验证 publisher trusted-transport 回执修复（Brain 1.273.90）后，
harness_initiative 能否拿到 publish 成功并走到 merge。

拦路根因（r19 已定位）：Diff Impact Gate（`packages/brain/src/impact-contract/diff-gate.js`）
的 Mapper 可判定性校验（步骤 3a）把 Mapper 返回的**一切** `freshness.status !== 'fresh'` 情形
一律折叠成 `reason: 'mapper_stale', retryable: true`。当 Map 其实给出了**确定性结论**
（自带 `reason_code`、freshness 携带确定性非重试原因）时，该结论被丢弃、换成通用 mapper_stale
且永远 retryable，导致 `deny:impact:mapper_stale` 无限重试空转（实证 runs f62c7e87 / d1360a48）。

## Golden Path（核心场景）

系统从 [Diff Impact Gate 复算影响半径] → 经过 [Mapper 返回确定性结论] → 到达 [透传 reason_code 并 fail-closed 退出，不再空转]

具体：
1. [触发条件] harness attempt 进入 Diff Impact Gate，`evaluateDiffGate` 调用 Mapper 复算影响半径。
2. [系统处理] Mapper 返回结果非 `fresh`，但携带**确定性 reason_code**（如 provider/deny 类确定结论，
   非"事实投影尚未刷新"这种真·瞬时 stale）。
3. [可观测结果] Gate 出口 `reason` = Mapper 原始 `reason_code`（透传，不再覆盖成 `mapper_stale`），
   且当结论确定时 `retryable: false`（fail-closed 退出），attempt 得到终态裁决而非无限重试。
4. [对照] 仅当 Mapper 返回真·瞬时 stale（无确定性 reason_code、事实投影待刷新）时，才保留
   `reason: 'mapper_stale', retryable: true` 的重试语义。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- Mapper 结果既无 `freshness` 也无 `reason_code`：视为不可判定，保持 fail-closed（retryable 由确定性判据决定，绝不假绿）。
- Mapper 返回确定性 deny 但 `retryable` 字段缺失：Gate 以"有确定性 reason_code ⇒ 非重试"为准，防止回退到空转。
- 已存在的其它 impact_unknown 分支（db_unavailable / mapper_unavailable / revision_mismatch 等）语义不变，本 sprint 不动。

## 范围限定

**在范围内**：`diff-gate.js` 步骤 3a（`mapper_stale` 分支）的 reason_code 透传 + fail-closed 出口判定；配套 failing→passing 回归测试。
**不在范围内**：Mapper（map-client / state-resolver）自身逻辑、其它 gate（structure-gate）、publisher 回执链（1.273.90 已修，本 run 仅验证其成果）。

## 假设

- [ASSUMPTION: thin_prd 为空，scope 依据 task title(r19) + issue_ref(runs f62c7e87/d1360a48 deny:impact:mapper_stale 空转) + map_scope=["F1"] 锚定，主题字面为 "reason_code 透传 + fail-closed 出口"。]
- [ASSUMPTION: Mapper 结果对象在确定性结论时会携带 `reason_code`（顶层或 freshness 内）；Proposer 需在 map-client 返回契约中确认字段名。]
- [ASSUMPTION: "确定性结论"判据 = 存在非空 reason_code 且非 "尚未刷新" 类瞬时原因；精确判据由 Proposer 在合同 GAN 阶段 codify。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 步骤 3a `mapper_stale` 分支改为透传 reason_code + fail-closed 出口判定。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`（或 harness-gates.test.js）: 新增 failing→passing 回归——确定性 reason_code 必须透传且 retryable=false，瞬时 stale 仍 retryable=true。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空）；PrepPRD/thin_prd 无显式 NFR；下列为模块 fail-closed 原则派生 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控/重试: 确定性 deny 不得无限重试（retryable=false 终态）；仅真·瞬时 stale 可 retryable=true
- 版本要求: 无
- 可观测: Gate 出口 `reason` 必须携带 Mapper 原始 reason_code，禁止折叠成通用 mapper_stale 掩盖真因

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step+journey_feature 空；area 级取回 1 条 + 模块 fail-closed 原则 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿（来源: 模块 diff-gate.js 头注）
- [nightly-red 文案] 连续 ≥3 晚同一 job 红时，issue 贴失败 step 最后 20 行原始 stdout，非 PowerShell 截断输出（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 golden-paths 查询返回空 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node --test 跑回归 + curl localhost:5221 验 harness attempt 终态）
# 期望验收点（自然语言）：
#   1. 构造 Mapper 返回"确定性 reason_code + 非 fresh"的用例 → evaluateDiffGate 出口 reason == 该 reason_code 且 retryable == false（不再空转）。
#   2. 构造 Mapper 返回"真·瞬时 stale（无 reason_code）"用例 → 出口仍 reason=='mapper_stale' 且 retryable==true（重试语义保留）。
#   3. kernel harness r21 全链：本 task 走到 publish 成功并 merge（验证 1.273.90 回执修复 + 本 fix 合力打通 publish→merge）。
```

## journey_type: autonomous
## journey_type_reason: 变更落在 packages/brain/src/impact-contract/（纯后端 harness gate），无 UI/agent 协议/engine 介入。
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；本地 evaluator 跑 node --test + curl localhost:5221 验 harness attempt 终态。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
