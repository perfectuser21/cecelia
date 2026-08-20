# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 有界出口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness run 因 mapper_stale 无限重试而空转、零人碰 merge）

## 背景

runs `f62c7e87` / `d1360a48` 观察到 `deny:impact:mapper_stale` 空转：Diff Impact Gate（`evaluateDiffGate`）在校验 Map 可判定性时，只要 `freshness.status !== 'fresh'` 就一律折叠成通用 `reason: 'mapper_stale'` 且 `retryable: true`，把 Map 已经给出的**确定性结论**（state-resolver 会返回 `fail_current_revision` / `revision_mismatch` / `no_receipt` 等具体 reason_code）也当成瞬态过期，导致 run 无限重试、永不落地。r30 的三批修复（重派保活 1.273.96 / guard 期限 1.273.97 / 回执候选头 1.273.98）已齐备，本 sprint 补上最后一环：让确定性 Map 结论走 fail-closed 有界出口，实现"零人碰到 merge"。

## Golden Path（核心场景）

系统从 [run 进入 Diff Impact Gate 裁决] → 经过 [Gate 识别 Map 结论是确定性还是真·瞬态过期] → 到达 [确定性结论透传 reason_code 并 fail-closed 有界终止，不再空转]

具体：
1. [触发条件] 一个带 impact contract 的 harness run 进入 `evaluateDiffGate`，Map 事实层返回一个带**确定性 reason_code** 的结论（如 `fail_current_revision` / `revision_mismatch` / `no_receipt`），而非单纯 freshness 不足。
2. [系统处理] Gate 识别该结论为确定性（非瞬态过期），**透传 Map 的 reason_code**，不再一律折叠成 `mapper_stale`；对确定性结论给出 `retryable: false` 的 fail-closed 出口。
3. [可观测结果] 编排层落地 `deny:impact:<真实 reason_code>` 且 `retryable=false`，run 有界终止/上报，不再无限重试空转；真·瞬态过期（无确定性 reason_code）仍保留 `mapper_stale` + `retryable=true`。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- Map 真·stale（`freshness.status !== 'fresh'` 且无确定性 reason_code）→ 仍返回 `mapper_stale` + `retryable=true`，保留原有瞬态重试语义，不被本次改动误伤。
- Mapper 不可达（抛异常）→ 保持 `mapper_unavailable` + `retryable=true`（fail-closed，绝不假绿）。
- reason_code 缺失/为空但结论确定 → 默认 fail-closed（`retryable=false`），不得因缺 reason_code 反而放行或转回无限重试。
- 幂等：同一 run 重复进 Gate，确定性结论每次给出一致的 reason_code 与 retryable，不产生新的空转轮次。

## 范围限定

**在范围内**：
- `evaluateDiffGate` 的 Map 可判定性校验分支：区分"确定性结论"与"真·瞬态过期"，确定性结论透传 Map 的 `reason_code`。
- 确定性结论的 fail-closed 有界出口（`retryable: false`），阻断 `mapper_stale` 无限重试。
- 对应 failing→passing 回归测试，永久保留在 CI。

**不在范围内**：
- 修改 Map / state-resolver 本体的判定逻辑或 reason_code 取值（Gate 只透传，不改判定）。
- 重派保活 / guard 期限 / 回执候选头 三批已完成的修复（r30 已齐备，本 sprint 不重做）。
- 调度层 retry 上限 / 退避策略的通用实现（本 sprint 只负责 Gate 出口正确标注 retryable）。

## 假设

- [ASSUMPTION: "确定性结论"判定依据 = Map 结果携带确定性 reason_code（如 `fail_current_revision` / `revision_mismatch` / `no_receipt` / `resolver_error` 等 terminal 码）而非 freshness 缺失；具体白名单由 Proposer 读 state-resolver 后 codify。]
- [ASSUMPTION: 编排层 `loop.js` 消费 Gate 返回的 `reason` 与 `retryable` 字段（已存在 `deny:impact:${reason}` 与 `retryable===false` 分支），本 sprint 不改编排层消费契约。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: Map 可判定性校验分支加"确定性 reason_code 透传 + fail-closed 有界出口"逻辑。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增回归测试（确定性 Map 结论不再折叠成 mapper_stale 无限重试；真·瞬态过期仍 retryable）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 两源均空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；Gate 为同步纯函数判定，无外部 IO 新增）
- 频控: 待定
- 版本要求: 无
- 可观测: 确定性 fail-closed 出口必须在 receipt 中带真实 `reason_code`，供 `deny:impact:<reason>` 落地可归因（不得吞成 unknown）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（step/feature 两源为空；area 源为 CI 无关铁律，不注入）；本条为本模块 SSOT 已 codify 的 fail-closed 原则 -->
- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿（来源: diff-gate.js 模块原则）
- [不空转] 确定性 Map 结论不得被折叠成 retryable 的 mapper_stale 无限重试；确定即 `retryable=false`（来源: 本 sprint 新增铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收 done/working ability 历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（Node 单测 + curl/psql 验证）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#  1) 构造 Map 返回确定性结论（如 reason_code=revision_mismatch，freshness 非 fresh）→ evaluateDiffGate
#     返回 reason=<该 reason_code>（非 mapper_stale）且 retryable=false（fail-closed 有界出口）。
#  2) 构造真·瞬态过期（freshness 非 fresh 且无确定性 reason_code）→ 仍返回 reason=mapper_stale 且 retryable=true。
#  3) diff-gate.test.js 全绿；回归用例证明 deny:impact:mapper_stale 空转不再复现。
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端 impact-contract 裁决逻辑，无 UI / 远端 agent / engine 参与。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；Gate 为 Brain 内部纯后端判定，本地 evaluator 跑 Node 单测 + curl localhost:5221 即可验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
