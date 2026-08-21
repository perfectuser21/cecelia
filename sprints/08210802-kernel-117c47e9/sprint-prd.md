# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口（r34）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（harness kernel 收敛，消除 mapper_stale 空转导致的 zero-human-gate 破洞）

## 背景

runs f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转：Diff Impact Gate（`packages/brain/src/impact-contract/diff-gate.js`）在复算影响半径时，把 Mapper 返回的**确定性**结论（`freshness.status` ∈ {`stale`,`unknown`} 且携带 `reason_code`）一律折叠成 `{ reason:'mapper_stale', retryable:true }`，丢弃了 Mapper 自己的 `reason_code`。派发层看到 `retryable:true` 就无限重试，任务永远不终结、也永远到不了人工 merge。本 sprint 让 gate 透传 `reason_code` 并对确定性结论走 fail-closed 终态出口，达到「零人碰到 merge」——任务要么自动收敛，要么终态 blocked，绝不空转。

## Golden Path（核心场景）

系统从 [编码后进入 Diff Impact Gate] → 经过 [Mapper 复算返回确定性非 fresh 结论] → 到达 [透传 reason_code 且 fail-closed 终结，不再空转]

具体：
1. capability_change 任务编码完成，`evaluateDiffGate` 读取 active impact contract，用 mapClient 以 head revision 复算影响半径。
2. Mapper 返回 `freshness.status` ≠ `fresh`（`stale` 或 `unknown`）且携带确定性 `reason_code`（表示「重试不会变 fresh」，非暂时抖动）。
3. gate 不再把结论折叠成写死的 `mapper_stale`：返回体**透传 Mapper 的 `reason_code`**（`freshness.reason_code`），可被 runs / gap ledger 观测到真实拒绝原因。
4. 对确定性结论 gate 走 **fail-closed 终态出口**：返回 `retryable:false`，任务进入终态（不再被派发层无限重试）；「零人碰到 merge」——自动终结而非人工介入。
5. 暂时性 stale（无确定性 `reason_code` / 明确可恢复）保持 `retryable:true` 原有可恢复语义，不被本 fix 误杀。
6. 出口：观测点显示 verdict 携带真实 `reason_code`；确定性场景任务终态收敛、`deny:impact:mapper_stale` 空转消失。

## 边界情况

- `freshness` 缺失 / 为空对象（无 `reason_code`）：无法判定是否确定性 → 保守，保持 `retryable:true`（避免误杀暂时抖动），但不得以旧的写死 `mapper_stale` 掩盖来源。
- `freshness.status = 'unknown'` 与 `'stale'` 需分别处理：`unknown` 通常代表 Mapper 无法给出确定投影，`stale` 代表投影过期；两者的 retryable 语义可能不同，由 reason_code 主导。
- `reason_code` 为未知枚举值：默认 fail-closed 终态（宁可 blocked 也不空转）。
- 连续重试次数已达 `max_retries`：即便 retryable，也必须终态收敛，不得空转（与 dispatch-fail-autoblock 语义一致）。

## 范围限定

**在范围内**：
- `evaluateDiffGate` step 3a（`diff-gate.js:202-208`）非 fresh 分支的 reason_code 透传与 retryable 判定。
- 复现该空转的 Red 回归测试（bug 修复前必须先红）。

**不在范围内**：
- Mapper（map-client.js）自身 freshness/reason_code 的产出逻辑。
- revision_mismatch / manifest_digest_mismatch / projection_digest_mismatch 等其它 impact_unknown 分支的语义变更。
- diff-compare.js 对账裁决（pass/extend/drift）逻辑。

## 假设

- [ASSUMPTION: 「确定性结论」的判定依据 = `freshness.reason_code` 非空且非可重试枚举；具体枚举清单由 proposer 在合同 GAN 阶段读 map-client / contract-schema 锁定。]
- [ASSUMPTION: fail-closed 终态对外表现为 `gate:'impact_unknown', retryable:false`；是否额外把任务标 `blocked` 由 proposer 依现有 blockTask 语义定。]
- [ASSUMPTION: 无 `reason_code` 时保守 `retryable:true`，保留暂时性 stale 的可恢复路径。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: step 3a 非 fresh 分支——透传 `reason_code`、按确定性给 `retryable`。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`: 新增复现空转的 Red 回归断言（reason_code 透传 + 确定性 retryable:false），修后永久保留。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + feature 双源均为空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控/重试: 确定性结论必须终态收敛，不得触发无限重试空转（本 sprint 核心约束）
- 版本要求: 无
- 可观测: gate 拒绝时必须携带真实 `reason_code`，可在 runs / gap ledger 观测到（禁止写死 `mapper_stale` 掩盖来源）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 两源为空；area 源一条 + 代码基线派生一条 -->
- [不假绿] Mapper 任何不可判定情形均 fail-closed，绝不假绿放行（来源: 代码基线 diff-gate.js header 设计不变量）
- [nightly-red 文案] 连续 ≥3 晚同一 job 红时，issue 贴失败 step 最后 20 行原始 stdout（非 PowerShell 截断）（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
- （本 line 暂无与 Diff Impact Gate 相关的已验收 golden_path 历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 按 target_environment=local_api 填入（vitest/node 跑 diff-gate 回归 + 断言 reason_code 透传与 retryable 语义）。

```bash
# 占位：proposer 将填入 local_api 脚本
# 期望验收点（自然语言）：
#  1) 复现：Mapper freshness.status=stale/unknown 且带确定性 reason_code 时，
#     修前 gate 返回 reason:'mapper_stale', retryable:true（Red 可复现空转）。
#  2) 修后：gate 返回体透传该 reason_code（非写死 mapper_stale），
#     且确定性结论 retryable:false（终态收敛，不再无限重试）。
#  3) 保护：无 reason_code 的暂时性 stale 仍 retryable:true，未被误杀。
```

## journey_type: autonomous
## journey_type_reason: 变更落在 packages/brain/ 纯后端 impact-contract 判定逻辑，无 UI / 无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；Brain 内部 gate 逻辑，本地 vitest + curl localhost:5221 即可验收。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
