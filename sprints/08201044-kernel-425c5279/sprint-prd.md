# Sprint PRD — Diff Impact Gate：透传 reason_code + 确定性 unknown 走 fail-closed 出口

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **当前进度**：82%
- **本次推进预期**：+1%（r27 干净窗口，堵住 harness 空转的最后一个无限重试洞，逼近零人碰 merge）

## 背景

runs f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转：Diff Impact Gate 的「非 fresh」分支把 Mapper 的**确定性**结论（`freshness.status === 'unknown'`，如 projection revision 结构不符、能力不在活跃投影里、anchor 缺失）和**瞬态**结论（`status === 'stale'`，快照落后）一律折叠成同一个 `reason: 'mapper_stale'` + `retryable: true`。确定性结论本应 fail-closed 收敛，却被打上 retryable 让 kernel 无限重派——run 永远转圈、无人能推进到 merge。r27 窗口（runner_failure 有界重派 + 断言明细已在 1.273.96 上线）目标零人碰 merge，此洞必须堵。

## Golden Path（核心场景）

系统从 [Gate 被调用] → 经过 [读 freshness.status 二分] → 到达 [透传 reason_code 的收敛出口]

具体：
1. kernel/orchestrator 调 `evaluateDiffGate`，Mapper 复算返回 `freshness.status !== 'fresh'`，进入非 fresh 分支。
2. Gate 读取 `freshness.status` 与 `freshness.reason_code`，**不再无条件贴 `mapper_stale`**。
3. 瞬态：`status === 'stale'`（如 `fact_snapshot_stale`）→ `gate: impact_unknown`、`retryable: true`、`reason` = 透传的具体 reason_code（非 `mapper_stale`）→ kernel 有界重试。
4. 确定性：`status === 'unknown'`（如 `graph_projection_revision_mismatch` / `capability_not_in_active_projection` / `impact_anchor_missing`）→ `gate: impact_unknown`、`retryable: false`（**fail-closed 出口**）、`reason` = 透传的具体 reason_code → kernel 停止重试。
5. 出口：orchestrator 得到 `gateVerdict = deny:impact:<具体reason_code>`（不再是 `deny:impact:mapper_stale`），确定性结论让 run 收敛而非无限重派。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry/源码后推导，Planner 不定义技术规范。 -->

## 边界情况

- `freshness` 缺失（null/undefined）→ 无法判定，维持 fail-closed，绝不放行 pass。
- `status === 'unknown'` 但 `reason_code` 缺失 → 仍 fail-closed（`retryable: false`），reason 用确定性兜底码，禁止回退成 `mapper_stale`。
- `status === 'stale'` 但 `reason_code` 缺失 → `retryable: true`，reason 用瞬态兜底码。
- 已有的 `revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch` 等分支语义**不变**，只改「非 fresh」这一处折叠。
- `structure-gate.js:124` 存在同源折叠（同样把非 fresh 统一成 `mapper_stale` 503 retryable）——本 sprint Golden Path 出口锚在 diff-gate，structure-gate 是否同修由 proposer 判定，不强制纳入。

## 范围限定

**在范围内**：`diff-gate.js` 非 fresh 分支——按 `freshness.status` 做 stale(瞬态,retryable) vs unknown(确定性,fail-closed) 二分，并透传具体 `reason_code`。
**不在范围内**：Mapper freshness 本身的判定逻辑（`map/radius.js`、`map/state-resolver.js` 不改）；重试上界 / 有界重派机制（已在 1.273.96 上线）；drift/extend/pass 裁决路径。

## 假设

- [ASSUMPTION: `freshness.status` 三态语义固定为 `fresh`(放行判定) / `stale`(瞬态可重试) / `unknown`(确定性 fail-closed)，与 contract-schema.js:136 的 zod enum 一致。]
- [ASSUMPTION: kernel 消费 `retryable` 字段决定是否重派；`retryable: false` 即让本轮收敛为 deny 终态，不再进重派队列。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：非 fresh 分支（当前 L202-208）从无条件 `mapper_stale` 改为按 `freshness.status` 二分 + 透传 `reason_code`。
- `packages/brain/src/__tests__/harness-judge.test.js`：已含 GP Step2/Step3 断言，其中确定性出口断言现为红（L1394「实际返回 mapper_stale」），修后转绿。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` / `harness-gates.test.js`：新增/更新回归——transient→retryable、deterministic→fail-closed、reason_code 透传三条。
- `packages/brain/src/orchestrator/__tests__/loop.test.js`：`gateVerdict` 不再固定为 `deny:impact:mapper_stale` 的断言更新。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+journey_feature 双源均为空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；Gate 为进程内同步判定，无额外时延要求）
- 频控: 无
- 版本要求: 无
- 可观测: 确定性 fail-closed 出口必须带具体 reason_code，供 orchestrator gateVerdict 与断言明细诊断（1.273.96）落地归因，禁止再出现裸 `mapper_stale` 遮蔽真因。

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 `target_environment=local_api` 填入（vitest 单测 + 可选 orchestrator loop 集成）。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest + curl localhost:5221 / psql）
# 期望验收点（自然语言）：
#  1. mapperResult.freshness={status:'unknown', reason_code:'graph_projection_revision_mismatch'} 调 evaluateDiffGate
#     → gate=impact_unknown, retryable=false, reason=透传的具体 code（断言 !== 'mapper_stale'）。
#  2. freshness={status:'stale', reason_code:'fact_snapshot_stale'} → retryable=true, reason 透传具体 code。
#  3. orchestrator loop：确定性 unknown 场景下 gateVerdict 不再是 deny:impact:mapper_stale 且不进重派（run 收敛）。
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step+journey_feature 双源为空；area 源 + 模块契约合并 -->
- [fail-closed] Impact Gate 任何不可判定情形绝不返回 pass，确定性 unknown 必须 `retryable: false` 收敛，不得靠 retryable 遮蔽（来源: impact-contract 模块契约 structure-gate.js:14）
- [透传真因] 非 fresh 出口必须透传 Mapper 的具体 `reason_code`，禁止折叠成裸 `mapper_stale`（来源: 本 sprint 合同）
- [原始归因] nightly-red / 失败诊断贴原始 stdout 而非截断输出，保留可归因真因（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey abilities 均为 planned，无 done/working -->
- （本 line 暂无历史）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端 Impact Gate 判定逻辑，无 UI / agent 协议 / engine hook。
## target_environment: local_api
## target_environment_reason: payload 显式给定 local_api；纯 Brain 内部函数，evaluator 本地跑 vitest + curl localhost:5221 即可验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
