# Sprint Contract Draft (Round 1)

Diff Impact Gate 非 fresh 分支：按 `freshness.status` 做 stale(瞬态,retryable) vs unknown(确定性,fail-closed) 二分，并透传具体 `reason_code`，堵住 `deny:impact:mapper_stale` 无限重试洞。

## 锚定父路声明

独立小路（无父路）。本 sprint 是 harness 内部 Diff Impact Gate 判定逻辑的 bug 修复，累积 FR「本 line 暂无历史」，无已有 golden_path 父路可挂。

## Response Schema（推导来源: 源码 packages/brain/src/impact-contract/diff-gate.js JSDoc + PRD Golden Path）

### 被测对象: `evaluateDiffGate(params)` 返回对象（非 HTTP 端点，进程内同步/异步函数返回）

**非 fresh 分支返回（HTTP N/A，函数 return object）**:
```json
{"gate": "impact_unknown", "reason": "<string reason_code>", "reason_code": "<string|null>", "retryable": <boolean>}
```
- `gate` (string, 必填): 非 fresh 分支恒为 `"impact_unknown"` —— 来源：源码步骤 3a 现状 + PRD Golden Path Step 3/4
- `reason` (string, 必填): 用于 orchestrator 构造 `gateVerdict = deny:impact:${reason}`（loop.js:1454 消费 `.reason`）。透传 `freshness.reason_code`；缺失时用兜底码（见下表）。**确定性分支绝不为 `"mapper_stale"`** —— 来源：PRD 边界 + Invariant [透传真因]
- `reason_code` (string|null, 必填): 原始归因字段，透传 Mapper 的 `freshness.reason_code`；缺失时为 `null`。供断言明细诊断（1.273.96）落地归因 —— 来源：源码 JSDoc 返回类型已含 `reason_code?: string|null`
- `retryable` (boolean, 必填): kernel 消费此字段决定是否重派。瞬态 `true`、确定性 `false`（fail-closed）—— 来源：PRD Golden Path Step 3/4 + ASSUMPTION[kernel 消费 retryable]

**reason / reason_code / retryable 取值真值表（本 sprint 唯一新增逻辑，Generator 必须逐行实现）**:

| `freshness` 入参 | `freshness.status` | `freshness.reason_code` | 出 `retryable` | 出 `reason` | 出 `reason_code` |
|---|---|---|---|---|---|
| 有 | `stale` | `fact_snapshot_stale`（存在） | `true`（瞬态） | `fact_snapshot_stale`（透传） | `fact_snapshot_stale` |
| 有 | `stale` | 缺失 | `true`（瞬态） | `mapper_stale`（瞬态兜底码） | `null` |
| 有 | `unknown` | `graph_projection_revision_mismatch`（存在） | `false`（fail-closed） | `graph_projection_revision_mismatch`（透传） | `graph_projection_revision_mismatch` |
| 有 | `unknown` | 缺失 | `false`（fail-closed） | `mapper_unknown`（确定性兜底码，**禁 `mapper_stale`**） | `null` |
| `null`/`undefined`（缺失） | — | — | `false`（fail-closed，**绝不放行 pass**） | `mapper_unknown`（确定性兜底码） | `null` |
| 有 | 其它非 fresh 值（防御，zod enum 外） | — | `false`（fail-closed 默认收敛） | `mapper_unknown` | `null` |

**禁用/不变约束**:
- 确定性（unknown/缺失/其它非 fresh）出口的 `reason` **绝不允许**回退成字面量 `"mapper_stale"`（PRD 边界 + Invariant [透传真因]）。
- 已有分支语义不变：`revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch` / `revision_evidence_missing` / `mapper_unavailable` / `db_unavailable` / `contract_missing` 六个既有出口一字不改（PRD 边界「已有的…分支语义不变」）。
- Mapper freshness 判定逻辑（`map/radius.js`、`map/state-resolver.js`）不改（PRD 范围外）。
- `fresh` 分支后续 revision/digest 对账与 pass/extend/drift 裁决路径不改（PRD 范围外）。

## 已知约束（来自回归测试）

- [packages/brain/src/map/radius.test.js] → 确定性 `status: 'unknown'` 的 reason_code 全集在此固定：`graph_projection_revision_mismatch` / `unsafe_assertion_ref` / `capability_not_in_active_projection` / `impact_anchor_missing` / `capability_assertion_coverage_missing` / `assertion_identity_ambiguous`；瞬态 `status: 'stale'`：`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch`。本 sprint 只消费 status 二分 + 透传 code，不新增/改判任何 code。
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 既有 `impact_unknown` fail-closed 回归（manifest_digest_mismatch / mapper 抛异常 / fact_revisions 缺失）必须保持绿，本 sprint 只改「非 fresh」这一处折叠。
- [packages/brain/src/impact-contract/__tests__/harness-gates.test.js:395/409] → `beforeMerge` 直接 mock `diffGate` 返回 `{gate:'impact_unknown',reason:'mapper_stale',retryable:true}`（mock 的是 diffGate 出参，非本 sprint 改的 freshness→verdict 边），不受本 sprint 影响，保持绿。
- [packages/brain/src/orchestrator/__tests__/loop.test.js:338-348] → loop 由 `impactGateReceipt.reason` 构造 `gateVerdict = deny:impact:<reason>`（既有未改逻辑）；本 sprint 更新为确定性场景断言 `gateVerdict !== deny:impact:mapper_stale` 且走 `retryable:false` 收敛（不进重派）。
- [累积FR] context-manifest: 本 line 暂无历史累积 FR（PRD「本 line 暂无历史」）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | Diff Gate 非 fresh 出口按 `freshness.status` 二分（stale→retryable、unknown/缺失→fail-closed）并透传 `freshness.reason_code` 到 `reason`/`reason_code`。 |
| **NFR（做得多好）** | 性能/可靠性 | 进程内同步判定，无额外时延要求（PRD NFR：Gate 为进程内判定，无额外时延要求）。 |
| **Invariant（永不违反）** | 不变量 | ①fail-closed：不可判定绝不 pass，确定性 unknown 必 `retryable:false`（不得靠 retryable 遮蔽）；②透传真因：非 fresh 出口透传具体 reason_code，禁折叠裸 `mapper_stale`；③原始归因：诊断保留原始真因。 |
| **判定点（怎么知道）** | 模糊现实判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 失效退役 | N/A —— 纯判定逻辑，无 token/快照过期语义（freshness 快照的保质期由 Mapper 侧负责，PRD 范围外）。 |
| **死亡告警（停了谁知道）** | 停止工作告警 | 复用现有 orchestrator gateVerdict + 断言明细诊断（1.273.96）落归因；确定性出口带具体 reason_code 即为可归因信号，无新增告警通道。 |
| **失败语义（挂了怎么办）** | 故障放行/拦截 | 见下方失败语义声明。核心：任何非 fresh/不可判定 = 拦截（impact_unknown），确定性 = 收敛（retryable:false），瞬态 = 有界重试（retryable:true）。 |
| **效果确认（已发≠已生效）** | 回执确认 | 出口 `reason`/`reason_code`/`retryable` 三字段即回执；orchestrator gateVerdict 字符串 + kernel 是否重派为最终生效确认。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| Mapper 复算是否"确定性不可判定"（该收敛）vs"瞬态落后"（可重试） | A. 读 `freshness.status` 三态枚举（fresh/stale/unknown）; B. 按具体 reason_code 字符串白名单分类; C. 沿用旧逻辑一律 stale | A. 读 `freshness.status` 二分（`unknown`/缺失/其它=确定性 fail-closed，`stale`=瞬态） | status 是 Mapper 已归一化的三态枚举（contract-schema.js:136 zod enum），比 reason_code 字符串白名单稳，且 PRD ASSUMPTION 固定该三态语义 | 见下（误判即回到本 bug） |
| ⚠️ 确定性 unknown 被误判为可重试 | 同上 | 读 status，`unknown`/缺失→`retryable:false` | fail-closed 铁律要求确定性收敛 | ⚠️ run 永远转圈无限重派、无人推进 merge（本 sprint 要修的原病），误判后果严重 |

> ⚠️ 行属"升拍板点"级别。PrepPRD 已在 PRD ASSUMPTION 与 Invariant 中拍定"unknown=确定性 fail-closed、kernel 消费 retryable"，本判定点视为已确认，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `freshness.status==='stale'`（快照落后，瞬态） | 返回 `impact_unknown` + `retryable:true`，不放行 pass | 是（Gate 无副作用，纯读 freshness 计算；kernel 有界重派，1.273.96 上界兜底） | kernel 有界重试等 Mapper 快照追平 |
| `freshness.status==='unknown'`（结构不符/anchor 缺失，确定性） | 返回 `impact_unknown` + `retryable:false`（fail-closed 收敛） | 是（同一入参恒定同出，无副作用） | 本轮收敛为 deny 终态，不进重派队列，交由人/上游修结构 |
| `freshness` 缺失（null/undefined） | 返回 `impact_unknown` + `retryable:false`，绝不 pass | 是 | 同确定性收敛，reason 用 `mapper_unknown` 兜底码 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A —— 本 sprint 是 Brain 进程内 Diff Impact Gate 判定函数，入参 `mapperResult.freshness` 来自可信内部 Mapper（`queryImpactRadius`），非对外暴露 agent / 用户可写接口，无 prompt injection / 越权面。

## 禁 mock 边清单

- **Mapper freshness → diff-gate 裁决（本 sprint 唯一改动的那条边）**：本单改的正是 `evaluateDiffGate` 对 `mapperResult.freshness.status` 的解读→verdict。failing test 与回归测试**必须调用真实 `evaluateDiffGate`（禁止 `vi.mock`/stub diff-gate 本体或 `compareImpactContract`）**，只允许通过 `mapClient` 注入构造 `mapperResult.freshness` 作为**输入**（mapClient 是 Mapper 外层依赖，PRD 明确 Mapper 判定逻辑不改，注入其输出即等价真实上游产物——这是既有 diff-gate.test.js 的既定测试缝，不是被改的边）。
- **说明（Step 5 orchestrator 边）**：loop.js 由 `impactGateReceipt.reason` 构造 `gateVerdict` 并按 `retryable===false` 收敛，是**既有未改代码**，非本 sprint 改动边。本 sprint 不改 loop.js。GP Step 5 在 `loop.test.js` 用 gate-receipt 形态注入（沿用既有 loop.test.js:338 测试风格）验证 loop 对新出参 shape 的既有消费逻辑，属对 loop 自身逻辑的验证，不涉及被改边——被改边（freshness→verdict）由 diff-gate 层真实调用覆盖。
- 无需真 Postgres：非 fresh 分支在 `evaluateDiffGate` 步骤 3a 于任何 DB 访问**之前**早返回（步骤 1 `if(db)` 可省略 db 入参），故禁 mock 边的真实验证在纯进程内完成（runtime_resources.postgres=false 一致）。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Golden Path

[kernel/orchestrator 调 evaluateDiffGate] → [Mapper 复算返回 freshness.status !== 'fresh' 进非 fresh 分支] → [读 freshness.status 二分 + 透传 reason_code] → [瞬态 stale=retryable / 确定性 unknown=fail-closed] → [orchestrator gateVerdict=deny:impact:<具体code>，确定性让 run 收敛]

### Step 1: kernel 调 evaluateDiffGate，Mapper 返回非 fresh，进入非 fresh 分支
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1（"Mapper 复算返回 freshness.status !== 'fresh'，进入非 fresh 分支"）

**可观测行为**: 以 `mapClient` 注入返回 `freshness.status !== 'fresh'` 的 mapperResult 调 `evaluateDiffGate`，函数进入步骤 3a 非 fresh 分支并返回 `gate === 'impact_unknown'`（不进入 pass/extend/drift 对账）。

**验证命令**:
```bash
cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"}})}); if(r.gate!==\"impact_unknown\"){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)} console.log(\"OK\",JSON.stringify(r))"
# 期望：exit 0，gate=impact_unknown
```

**硬阈值**: `gate === 'impact_unknown'`（非 fresh 恒入此分支）
**验证命令**: 见上 node 断言（`r.gate!=="impact_unknown"` → exit 1）

---

### Step 2: 瞬态 stale → retryable:true + 透传具体 reason_code（非 mapper_stale 折叠）
**来源**: `[FROM_PRD]` — Golden Path 步骤 3（"status==='stale' → retryable:true、reason=透传的具体 reason_code"）

**可观测行为**: `freshness={status:'stale', reason_code:'fact_snapshot_stale'}` 时返回 `retryable:true`、`reason:'fact_snapshot_stale'`、`reason_code:'fact_snapshot_stale'`（kernel 据此有界重试）。

**验证命令**:
```bash
cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"fact_snapshot_stale\"}})}); if(!(r.gate===\"impact_unknown\"&&r.retryable===true&&r.reason===\"fact_snapshot_stale\"&&r.reason_code===\"fact_snapshot_stale\")){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)} console.log(\"OK\",JSON.stringify(r))"
# 期望：exit 0，retryable=true 且 reason/reason_code 透传 fact_snapshot_stale
```

**硬阈值**: `retryable === true && reason === 'fact_snapshot_stale' && reason_code === 'fact_snapshot_stale'`
**验证命令**: 见上 node 断言

---

### Step 3: 确定性 unknown → retryable:false（fail-closed）+ 透传具体 reason_code
**来源**: `[FROM_PRD]` — Golden Path 步骤 4（"status==='unknown' → retryable:false（fail-closed 出口）、reason=透传的具体 reason_code"）+ Invariant [fail-closed]

**可观测行为**: `freshness={status:'unknown', reason_code:'graph_projection_revision_mismatch'}` 时返回 `retryable:false`（fail-closed 收敛）、`reason:'graph_projection_revision_mismatch'`、`reason_code` 同码，且 `reason !== 'mapper_stale'`（kernel 停止重试）。

**验证命令**:
```bash
cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"graph_projection_revision_mismatch\"}})}); if(!(r.gate===\"impact_unknown\"&&r.retryable===false&&r.reason===\"graph_projection_revision_mismatch\"&&r.reason_code===\"graph_projection_revision_mismatch\"&&r.reason!==\"mapper_stale\")){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)} console.log(\"OK\",JSON.stringify(r))"
# 期望：exit 0，retryable=false 且 reason 透传具体 code 且非 mapper_stale
```

**硬阈值**: `retryable === false && reason === 'graph_projection_revision_mismatch' && reason !== 'mapper_stale'`
**验证命令**: 见上 node 断言（这是修复前必红的核心断言：现状返回 mapper_stale/retryable:true）

---

### Step 4: 边界兜底 — reason_code 缺失 / freshness 缺失，确定性分支绝不回退 mapper_stale
**来源**: `[FROM_PRD]` — PRD「边界情况」三条（freshness 缺失 fail-closed / unknown 无 reason_code 用确定性兜底码禁回退 mapper_stale / stale 无 reason_code 用瞬态兜底码）

**可观测行为**:
- `freshness={status:'unknown'}`（无 reason_code）→ `retryable:false`、`reason:'mapper_unknown'`（确定性兜底码，**非 mapper_stale**）、`reason_code:null`。
- `freshness=null`（缺失）→ `retryable:false`、`reason:'mapper_unknown'`、`reason_code:null`，绝不放行 pass。
- `freshness={status:'stale'}`（无 reason_code）→ `retryable:true`、`reason:'mapper_stale'`（瞬态兜底码合法）、`reason_code:null`。

**验证命令**:
```bash
cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const u=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\"}})}); const m=await evaluateDiffGate({mapClient:async()=>({freshness:null})}); const s=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"stale\"}})}); const okU=u.retryable===false&&u.reason===\"mapper_unknown\"&&u.reason!==\"mapper_stale\"&&(u.reason_code===null||u.reason_code===undefined); const okM=m.gate===\"impact_unknown\"&&m.retryable===false&&m.reason!==\"mapper_stale\"; const okS=s.retryable===true&&s.reason===\"mapper_stale\"; if(!(okU&&okM&&okS)){console.error(\"FAIL\",JSON.stringify({u,m,s}));process.exit(1)} console.log(\"OK\")"
# 期望：exit 0 —— unknown 无码=mapper_unknown 且非 mapper_stale；freshness 缺失=fail-closed 非 mapper_stale；stale 无码=mapper_stale 瞬态兜底
```

**硬阈值**: unknown 无码 `reason==='mapper_unknown' && reason!=='mapper_stale' && retryable===false`；freshness 缺失 `retryable===false && reason!=='mapper_stale'`；stale 无码 `retryable===true`
**验证命令**: 见上 node 断言

---

### Step 5: orchestrator gateVerdict=deny:impact:<具体code>，确定性 unknown 让 run 收敛（不进重派）
**来源**: `[FROM_PRD]` — Golden Path 步骤 5（"orchestrator 得到 gateVerdict = deny:impact:<具体reason_code>，确定性结论让 run 收敛而非无限重派"）

**可观测行为**: loop.js 由 `impactGateReceipt.reason` 构造 `gateVerdict = deny:impact:${reason}`（既有未改逻辑，loop.js:1454），并对 `retryable===false` 走收敛分支（loop.js:1542，不进重派）。当 Diff Gate 返回确定性出参（reason=具体 code、retryable:false）时，orchestrator 记录的 `gateVerdict` 不再是 `deny:impact:mapper_stale`。用 `loop.test.js` gate-receipt 形态注入（沿用既有测试风格）断言：确定性出参 → `gateVerdict` 携带具体 code 且不进重派。

**验证命令**:
```bash
cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js -t "Diff Gate" 2>&1 | tail -8 | grep -Eq "[1-9][0-9]* passed" || { echo "FAIL: loop gateVerdict 断言未过"; exit 1; }
echo "OK loop gateVerdict"
```

**硬阈值**: loop.test.js「Diff Gate」相关用例全过，确定性场景 `gateVerdict !== 'deny:impact:mapper_stale'`
**验证命令**: 见上（Generator 更新 loop.test.js 相应断言；本命令用子 shell 切进 packages/brain 跑其自身 vitest 配置，遵守 9.25 工作目录死规则）

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 改的是 Brain 进程内纯判定函数 `evaluateDiffGate`，非 fresh 分支在任何 DB 访问之前早返回（runtime_resources.postgres=false，无需真库、无需起 Brain server）。因此 E2E 直接以 node 真实执行被改函数 + 子 shell 跑 packages/brain 自身 vitest 回归。**vitest 工作目录死规则（9.25）**：对 `packages/brain/src/**` 的 vitest 一律 `(cd packages/brain && npx vitest run --no-cache ./src/...)`，不从仓库根跑。sprints/** 下的合同 red 测试才从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail

echo "▶ 1/5 非 fresh 恒入 impact_unknown 分支（Step 1）"
(cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"impact_anchor_missing\"}})}); if(r.gate!==\"impact_unknown\"){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}")

echo "▶ 2/5 瞬态 stale → retryable:true + 透传 reason_code（Step 2）"
(cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"stale\",reason_code:\"fact_snapshot_stale\"}})}); if(!(r.gate===\"impact_unknown\"&&r.retryable===true&&r.reason===\"fact_snapshot_stale\"&&r.reason_code===\"fact_snapshot_stale\")){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}")

echo "▶ 3/5 确定性 unknown → retryable:false（fail-closed）+ 透传具体 code，非 mapper_stale（Step 3）"
(cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const r=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\",reason_code:\"graph_projection_revision_mismatch\"}})}); if(!(r.gate===\"impact_unknown\"&&r.retryable===false&&r.reason===\"graph_projection_revision_mismatch\"&&r.reason_code===\"graph_projection_revision_mismatch\"&&r.reason!==\"mapper_stale\")){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}")

echo "▶ 4/5 边界兜底 — 缺 reason_code / 缺 freshness，确定性绝不回退 mapper_stale（Step 4）"
(cd packages/brain && node --input-type=module -e "import {evaluateDiffGate} from \"./src/impact-contract/diff-gate.js\"; const u=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"unknown\"}})}); const m=await evaluateDiffGate({mapClient:async()=>({freshness:null})}); const s=await evaluateDiffGate({mapClient:async()=>({freshness:{status:\"stale\"}})}); const okU=u.retryable===false&&u.reason===\"mapper_unknown\"&&u.reason!==\"mapper_stale\"; const okM=m.gate===\"impact_unknown\"&&m.retryable===false&&m.reason!==\"mapper_stale\"; const okS=s.retryable===true&&s.reason===\"mapper_stale\"; if(!(okU&&okM&&okS)){console.error(\"FAIL\",JSON.stringify({u,m,s}));process.exit(1)}")

echo "▶ 5/5 packages/brain 回归 + orchestrator gateVerdict（Step 5，子 shell 跑 brain 自身 vitest）"
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/harness-gates.test.js ./src/orchestrator/__tests__/loop.test.js 2>&1 | tail -12 | grep -Eq "Test Files.*passed" || { echo "FAIL: brain 回归未全绿"; exit 1; })

echo "✅ Golden Path 验证通过（Diff Impact Gate 透传 reason_code + 确定性 fail-closed）"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（it() 名子串） | 预期红证据 |
|---|---|---|---|
| 确定性 unknown fail-closed 透传 | `tests/diff-gate-reason-passthrough.test.ts` | `确定性 unknown 返回 retryable false 且透传具体 reason_code 非 mapper_stale` | 现状返回 mapper_stale/retryable:true → 4 断言红 |
| 瞬态 stale retryable 透传 | `tests/diff-gate-reason-passthrough.test.ts` | `瞬态 stale 返回 retryable true 且透传具体 reason_code` | 现状 reason=mapper_stale ≠ fact_snapshot_stale → 红 |
| unknown 无码兜底 | `tests/diff-gate-reason-passthrough.test.ts` | `unknown 缺 reason_code 用确定性兜底码 mapper_unknown 且 retryable false` | 现状 retryable:true/reason=mapper_stale → 红 |
| freshness 缺失 fail-closed | `tests/diff-gate-reason-passthrough.test.ts` | `freshness 缺失维持 fail-closed retryable false 绝不 mapper_stale` | 现状 retryable:true/reason=mapper_stale → 红 |
| stale 无码兜底 | `tests/diff-gate-reason-passthrough.test.ts` | `stale 缺 reason_code 用瞬态兜底码 mapper_stale 且 retryable true` | 现状已巧合 mapper_stale/true（此条修后仍绿，守瞬态兜底不回退）|

> 说明：本 sprint 的**永久 CI 回归**由 Generator 落在 `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`（在 `src/**` include 内）。sprints/** 下本文件是 TDD Red 证据（根 vitest.config.js 已含 `sprints/**`，从仓库根 `npx vitest run` 跑）。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `mapClient` 返回 `freshness={status:'unknown', reason_code:''}`（空串 reason_code）/ `freshness={}`（无 status 字段）/ `freshness={status:'STALE'}`（大小写不符枚举）——验证不 crash 且落 fail-closed（非 stale 一律确定性收敛）。
- 边界值: `reason_code` 为超长字符串 / 含 `deny:impact:` 前缀的伪造 code——验证 gateVerdict 拼接不被注入破坏。
- 回退陷阱: 任一非 fresh 路径的 `reason` 是否仍可能等于 `mapper_stale`（除 stale-无码瞬态兜底外应全非）——重点探 unknown 分支绝不回退。
- 既有分支零回归: `fresh` + revision/digest 不符路径（revision_mismatch/manifest_digest_mismatch/projection_digest_mismatch）reason 是否仍原样，未被本改动波及。
发现分级: P0/P1（确定性被误判 retryable:true 复现无限重派 / fail-closed 被绕过放行 pass）→ 阻塞 merge；P2/P3（兜底码命名、诊断字段缺失）→ 记 findings 不阻塞。
