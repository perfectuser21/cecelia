# Sprint PRD — Diff Impact Gate 透传 Mapper reason_code 并按确定性 fail-closed

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（harness 全链零人碰直通 merge fence 的最后一处重试盲区）

## 背景

r41：r40 全链已证明 evaluator PASS→judge PASS→fence approve→merge_pr 发起，merge_pr 的 DIRTY 枚举盲区已修（#5004, 1.273.111）。十三批机制修复（1.273.99–111）全部上线，本轮在新 main 上重跑全链。

当前 `evaluateDiffGate` 第 3a 步（`packages/brain/src/impact-contract/diff-gate.js:201-208`）把 Mapper `freshness.status !== 'fresh'` 的**所有**情形一律折叠成 `reason: 'mapper_stale', retryable: true`。Mapper 的 `freshness.reason_code` 中有一类是**确定性结论**（如 `capability_not_in_active_projection` / `manifest_projection_mismatch` / `impact_anchor_missing` 等，重试不会变），被误判为可重试后进入无限重试，run 空转，永远到不了 merge fence。只有 `fact_snapshot_stale` / `projection_revision_missing`（快照/投影瞬时未就绪）与 `freshness` 完全缺失（null）才是真正可重试的瞬时态。

## Golden Path（核心场景）

系统从 [Diff Impact Gate 复算] → 经过 [按 reason_code 分类可重试性] → 到达 [确定性码 fail-closed、瞬时码保留重试，deny 标签带具体码]

具体：
1. 触发：worker PR 的 head revision 进入 Diff Impact Gate，`evaluateDiffGate` 调 Mapper 复算影响半径，Mapper 返回 `freshness.status !== 'fresh'` 且带一个确定性 `reason_code`（如 `capability_not_in_active_projection`）。
2. 系统处理：第 3a 步读取 `mapperResult.freshness.reason_code`；瞬时白名单 = `{fact_snapshot_stale, projection_revision_missing}`，白名单命中或 `reason_code == null`（含 freshness 缺失）→ `retryable: true`；其余任何确定性 reason_code → `retryable: false`（fail-closed，默认未知码也 fail-closed）。
3. 可观测结果：`evaluateDiffGate` 返回 `{ gate: 'impact_unknown', reason: <具体 reason_code>, retryable: <上述判定> }`；`gateReceipt` 透传该具体 reason_code，deny 标签不再是裸 `mapper_stale`；确定性场景 run 一次 fail-closed 停下，不再无限重试。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- `freshness` 对象整体缺失（`!mapperResult?.freshness`）→ reason_code 视为 null → 保留 `retryable: true`（可能是 Mapper 尚未产出，属瞬时）。
- `reason_code` 存在但不在瞬时白名单、也不在已知确定性清单（未来新增的未知码）→ 默认 fail-closed（`retryable: false`），符合 diff-gate.js:12 "任何不可判定情形绝不假绿" 铁律。
- 3b 之后的 revision/digest mismatch 分支不在本 sprint 范围（各自已有独立 reason，本轮只改 3a freshness 折叠）。

## 范围限定

**在范围内**：
- `evaluateDiffGate` 第 3a 步：透传 `freshness.reason_code`，按瞬时白名单 vs 确定性做 `retryable` 分类，`reason` 携带具体 reason_code。
- `gateReceipt`：确认 deny 收据的 `reason` 字段透传具体 reason_code（不再裸 `mapper_stale`）。

**不在范围内**：
- Mapper（`packages/brain/src/map/radius.js`）reason_code 产出逻辑不动。
- merge_pr / DIRTY 枚举（#5004 已修）不动。
- 3b/3c revision & digest mismatch 分支不动。

## 假设

- [ASSUMPTION: 瞬时可重试码就是本轮任务描述显式点名的 `fact_snapshot_stale` 与 `projection_revision_missing` 两个；其余 radius.js 产出的 reason_code（`projection_revision_mismatch`/`manifest_projection_mismatch`/`graph_projection_revision_mismatch`/`capability_not_in_active_projection`/`impact_anchor_missing`/`unsafe_assertion_ref`/`assertion_identity_ambiguous`/`capability_assertion_coverage_missing`）均视为确定性 fail-closed。]
- [ASSUMPTION: 采用白名单式判定——未知/未来新增 reason_code 一律 fail-closed，而非枚举确定性清单。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: 第 3a 步透传 reason_code + retryable 分类。
- `packages/brain/src/impact-contract/harness-gates.js`: 确认 `gateReceipt` deny 标签透传具体 reason_code（若已满足则仅加回归覆盖）。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增确定性 fail-closed / 瞬时保留重试 / null 保留重试的 failing→PASS 回归测试。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均空），PrepPRD 未指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；本改动为纯内存分类，无新增 I/O）
- 频控: 无
- 版本要求: 无
- 可观测: deny 收据必须带具体 reason_code，供 kernel 日志区分确定性 vs 瞬时（不得回落裸 mapper_stale）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（step/feature 空），补入 impact-contract 模块自身法（diff-gate.js:12）-->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿（来源: module）
- [无未知重试] 未在瞬时白名单内的 reason_code 一律 retryable=false，禁止把确定性结论当瞬时无限重试（来源: module）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史：journey e6f803f2 下 ability 均为 planned，无 done/working golden_path）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node 直调 evaluateDiffGate + psql 校验，无需起服务）。

```bash
# 占位：proposer 将填入 local_api 脚本（node 调 evaluateDiffGate + 断言返回 reason/retryable）
# 期望验收点（自然语言）：
#  1. mock Mapper 返回 freshness={status:'stale',reason_code:'capability_not_in_active_projection'}
#     → evaluateDiffGate 返回 reason='capability_not_in_active_projection' 且 retryable=false（fail-closed）
#  2. mock freshness={status:'stale',reason_code:'fact_snapshot_stale'}
#     → 返回 reason='fact_snapshot_stale' 且 retryable=true（瞬时保留重试）
#  3. mock freshness 缺失（null）→ retryable=true
#  4. gateReceipt('diff', 场景1结果) → receipt.reason 为具体码，非裸 'mapper_stale'
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 内 impact-contract 的纯后端裁决逻辑，无 UI / agent 协议 / engine 介入。
## target_environment: local_api
## target_environment_reason: Brain 内部函数级契约，evaluator 在本地 node 直调 evaluateDiffGate + curl localhost:5221 校验即可，无需真机。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
