# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 派发链上一处无限重试空转，零人碰 merge）

## 背景

runs f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转：Diff Impact Gate
在步骤 3a 把 Mapper **任何** 非 fresh 的 freshness 一律折叠成常量
`reason: 'mapper_stale', retryable: true`（`diff-gate.js:202-208`）。但 Mapper 的
`freshness.status` 有两类语义：

- `stale` = 事实快照滞后（`fact_snapshot_stale` / `projection_revision_*`），重跑 Map 后可能自愈 → 可重试；
- `unknown` = 结构性确定结论（`capability_not_in_active_projection` / `impact_anchor_missing` /
  `unsafe_assertion_ref` / `assertion_identity_ambiguous` / `capability_assertion_coverage_missing`），
  重跑只会得到同一答案 → **不可能靠重试自愈**。

确定性结论被伪装成 `mapper_stale + retryable:true` 后，dispatcher 依据 retryable 反复重新点火空转。本 sprint 让 Gate **透传真实 reason_code** 并对确定性结论 **fail-closed 出口**（retryable=false），把空转转成一次性终局 deny。

## Golden Path（核心场景）

系统从 [Diff Impact Gate 调用 Mapper] → 经过 [按 freshness.status 分流] → 到达 [终局 deny 或可重试 deny]

具体：
1. [触发] Diff Impact Gate 调 Mapper 复算影响半径，Mapper 返回
   `freshness: { status, reason_code }` 且 `status !== 'fresh'`。
2. [系统处理] Gate 不再输出常量 `mapper_stale`，而是把 `freshness.reason_code`
   原样透传为 receipt 的 `reason`；并按 status 决定 `retryable`：
   - `status === 'stale'`（事实快照滞后类）→ `retryable: true`（保留自愈重试）；
   - `status === 'unknown'`（结构性确定结论）→ `retryable: false`（fail-closed 终局）。
3. [可观测结果] 确定性结论下，dispatch deny receipt 变为
   `deny:impact:<真实 reason_code>` 且 retryable=false → dispatcher 停止重新点火，
   不再空转；stale 类仍 `deny:impact:<reason_code>` 且可重试，行为不回退。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- `freshness.reason_code` 缺失/为 null 但 status 非 fresh → 仍 fail-closed，reason 回退为
  `mapper_stale`（保底不假绿），retryable 按 status 判定（unknown→false）。
- Mapper 不可达（异常抛出）与 DB 不可达 → 保持既有 `mapper_unavailable` / `db_unavailable`
  可重试出口，不在本次改动范围。
- revision / manifest / projection digest mismatch 分支（步骤 3b）→ 保持既有行为，本次只改 3a。

## 范围限定

**在范围内**：
- `diff-gate.js` 步骤 3a：透传 `freshness.reason_code` + 按 `status` 决定 `retryable`（unknown→fail-closed）。
- 回归测试：确定性 `unknown` 结论产出终局 deny（retryable=false、reason=真实 code），
  以及 `stale` 类仍可重试。

**不在范围内**：
- Mapper（`map/radius.js`、`state-resolver.js`）产 reason_code 的逻辑不动。
- dispatcher / harness-gates 的 retry 消费逻辑不动（仅依赖其已消费 `retryable` 字段）。
- 步骤 1/2/3b/4/5 其它出口不动。

## 假设

- [ASSUMPTION: `status==='unknown'` 恒为结构性确定结论、`'stale'` 恒为可自愈滞后（以 `map/radius.js` 枚举为准）；dispatcher 消费 `retryable=false` 即停止重新点火，本次不改消费端。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a 由常量 `mapper_stale` 改为透传 reason_code + fail-closed 分流。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：新增 red 回归——unknown 终局 deny 不可重试、stale 可重试、reason_code 透传。

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（jest 单测 + 可选 curl 断言）。

```bash
# 占位：proposer 将填入真实脚本（local_api → jest 定向跑 diff-gate.test.js + 断言 receipt 字段）
# 期望验收点（自然语言）：
# 1) Mapper 返回 { freshness: { status:'unknown', reason_code:'capability_not_in_active_projection' } }
#    → diffGate 结果 gate=impact_unknown、reason='capability_not_in_active_projection'、retryable=false（终局，不再空转）。
# 2) Mapper 返回 { freshness: { status:'stale', reason_code:'fact_snapshot_stale' } }
#    → reason='fact_snapshot_stale'、retryable=true（保留自愈重试，不回退）。
# 3) 全仓已有 diff-gate/harness-gates 测试保持绿（无回退）。
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + feature 均为空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（无重试次数上限约束；本次靠 fail-closed 终止，不引入退避）
- 版本要求: 无
- 可观测: deny receipt 必须落 `deny:impact:<真实 reason_code>`，便于运维区分 stale 与确定性结论

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 为空；area 一条 + 模块契约 -->
- [不假绿] Mapper 任何不可判定情形绝不返回 pass/extend/假绿，必须落 impact_unknown/blocked（来源: 模块契约 diff-gate.js:12）
- [nightly-red原始日志] 连续≥3晚同一 job 红时，issue 贴失败 step 最后 20 行原始 stdout 而非 PowerShell 截断输出（来源: area，本 sprint 不涉及但为 line 铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path（done/working）；当前均为 planned，故占位 -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain/ 纯后端影响半径裁决逻辑，无 UI/agent 协议/engine 参与
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api，本地 evaluator 跑 jest（curl localhost:5221 可选），diff-gate 为 Brain 内部纯函数
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
