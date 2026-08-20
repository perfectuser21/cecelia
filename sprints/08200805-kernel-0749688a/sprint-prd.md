# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 影响门无限重试空转，保障调度可信）

## 背景

`packages/brain/src/impact-contract/diff-gate.js` 的 Diff Impact Gate 复算影响半径后，
在 step 3a（`freshness.status !== 'fresh'`）把 **所有** 非 fresh 情形一律折叠成
`{ reason: 'mapper_stale', retryable: true }`，并丢弃 Mapper 返回的 `freshness.reason_code`。

Mapper 的 `freshness` 有两类语义（见 `map/radius.js`）：`status:'stale'`（如 `fact_snapshot_stale`）= 瞬态、重扫可转 fresh；`status:'unknown'`（如 `capability_not_in_active_projection` / `impact_anchor_missing`）= **确定性结论**，同一 diff × 同一投影重算永远得同一答案。

当前把确定性 `unknown` 也标成可重试的 `mapper_stale`，下游 `orchestrator/loop.js:1454` 据此产出 `deny:impact:mapper_stale` 并因 `retryable:true` 无限重试（issue_ref: `runs f62c7e87/d1360a48 deny:impact:mapper_stale 空转`）。真实 reason_code 被吞，运维看不到根因，任务空转不落地。

## Golden Path（核心场景）

系统从 [编码后复算影响半径] → 经过 [Mapper 返回非 fresh freshness] → 到达 [按确定性区分可重试性并透传真实 reason_code]

具体：
1. Diff Impact Gate 调用 Mapper 复算，Mapper 返回 `freshness = { status, reason_code }` 且 `status !== 'fresh'`。
2. 系统读取 `freshness.reason_code` 并写入 gate 返回对象的 `reason_code` 字段（不再吞没、不再统一折叠成 `mapper_stale`）。
3. 系统按 `freshness.status` 判定可重试性：
   - `status === 'stale'`（瞬态）→ `retryable: true`（保持现状，重扫可恢复）；
   - `status === 'unknown'`（确定性结论）→ `retryable: false`（**fail-closed 出口**，停止无限重试，任务落到 blocked 而非空转）。
4. 可观测结果：`evaluateDiffGate(...)` 返回对象携带真实 `reason_code`；下游 `loop.js` 产出的 `deny:impact:<真实原因>` 携带确定性根因，确定性场景不再重复入队重试。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导；行为 oracle 见「E2E 验收」。 -->

## 边界情况

- `freshness.reason_code` 为 `null`/缺失但 `status === 'unknown'`：仍 `retryable: false`，`reason_code` 落为一个确定性占位原因（不得回退成可重试）。
- `status === 'stale'` 且 reason_code 缺失：`retryable: true`，`reason_code` 透传为 null/原值。
- 已有 revision/digest mismatch 分支（step 3b 及之后）不在本次改动语义内，保持原 `retryable` 行为。
- fail-closed 铁律不被削弱：本改动只调整 `retryable` 与 `reason_code`，`gate` 永远不因 Mapper 不可判定而变 pass。

## 范围限定

**在范围内**：
- `packages/brain/src/impact-contract/diff-gate.js` step 3a 非 fresh 分支：透传 `freshness.reason_code` + 按 `status` 区分 `retryable`（`unknown`→false，`stale`→true）。
- 新增可复现该 bug 的 failing test，并作为 CI 回归永久保留。

**不在范围内**：
- `structure-gate.js` 的同名 `mapper_stale` 分支（另一道门，HTTP 503 语义，单独 sprint）。
- `orchestrator/loop.js` 的重试策略与 `DETERMINISTIC_IMPACT_ERROR_CODES`（throw 分支已有独立处理，本次不动）。
- Mapper（`map/radius.js`）本体的 reason_code 生成逻辑。
- revision/digest mismatch 分支的 retryable 语义调整。

## 假设

- [ASSUMPTION: `freshness.status` 的确定性判据即 `=== 'unknown'`；`stale` 视为唯一瞬态可重试态。依据 `map/radius.js` 现有枚举。]
- [ASSUMPTION: 下游 `loop.js:1454` 消费 gate 的 `reason`/`retryable` 字段的既有契约不变，仅内容随本改动更精确；`reason_code` 为新增透传字段。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: step 3a 非 fresh 分支改造（透传 reason_code + 区分 retryable）。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增 unknown→fail-closed 与 stale→retryable 的失败→回归测试。
- `packages/brain/package.json`: 版本 bump（DevGate check-version-sync 要求，Brain 改动触发）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 无命中；PrepPRD 无显式 NFR；下列为本 sprint 语义内在约束 -->
- 确定性/幂等: 同一 diff × 同一投影的 `unknown` 结论必须给出稳定的 `retryable: false`，禁止空转重试（本任务核心判据）。
- 可观测: gate 非 fresh 返回必须携带真实 `reason_code`，供 `loop.js` 的 `deny:impact:<原因>` 落根因。
- fail-closed: Mapper 不可判定绝不放行为 pass/extend（既有铁律，改动不得削弱）。
- 超时/频控/版本要求: 待定（PrepPRD 未指定）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step/journey_feature 级本任务未配置（ability_id 为空），仅 area 级相关项 -->
- [重试身份] 基础设施重试必须保持确定性重试身份，确定性失败不得当瞬态无限重试（来源: area / generator_infrastructure_retry_identity）
- [确定性优先] 判据用确定性窗口/结论而非可漂移的瞬态信号，防重复计账/空转（来源: area / capture-triage learning）
- [fail-closed] 影响门任何不可判定情形均 fail-closed，绝不假绿放行（来源: diff-gate.js 模块铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（vitest + grep 源码断言）。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest + curl localhost:5221 / grep 源码）
# 期望验收点（自然语言）：
#  1. 新增 failing test 在修复前 RED、修复后 GREEN：
#     - mock mapClient 返回 freshness.status='unknown', reason_code='capability_not_in_active_projection'
#       → evaluateDiffGate 返回 reason_code==='capability_not_in_active_projection' 且 retryable===false
#     - mock mapClient 返回 freshness.status='stale', reason_code='fact_snapshot_stale'
#       → 返回 reason_code==='fact_snapshot_stale' 且 retryable===true
#  2. 运行 packages/brain vitest（含 diff-gate.test.js）全绿，回归测试保留在 CI。
#  3. grep diff-gate.js step 3a 分支：非 fresh 返回不再无条件 retryable:true，且含 reason_code 透传。
#  4. DevGate 三闸通过：facts-check / check-version-sync / check-dod-mapping。
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain 后端影响门纯逻辑，无 UI/agent 协议/engine 介入。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，本地 evaluator 走 vitest + curl localhost:5221 验证（payload 显式 local_api）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
