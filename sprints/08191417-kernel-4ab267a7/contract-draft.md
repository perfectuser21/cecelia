# Sprint Contract Draft (Round 1)

**Sprint**: fix(harness) — Diff Impact Gate 透传 reason_code 并 fail-closed 出口（r19/r22）
**journey_type**: autonomous
**target_environment**: local_api（纯后端 gate 逻辑；本 sprint 改动分支在触 DB 前返回，**不依赖 Postgres**，探针 db:null 直调 gate）
**contract-gate**: cecelia 仓，`packages/brain/src/lib/contract-gate.js` 存在 → 走代码层 Contract Gate（未跳过）
**gp-anchor**: skipped (product-map.json not found)

## 锚定父路声明

独立小路（无父路）—— 本 sprint 修 `Diff/Structure Impact Gate` 非 fresh 分支的 freshness 分类逻辑，属 Brain 内部 harness 门禁，不推进任何用户可见 Golden Path 的分步。

---

## Response Schema（推导来源: PRD 明确 + diff-gate.js 现有返回 shape）

本 sprint 无 HTTP 端点；「Response」= gate 函数（`evaluateDiffGate` / `evaluateStructureGate`）非 fresh 分支的返回对象。

### diff-gate 非 fresh 返回（`evaluateDiffGate`）
```json
{"gate": "impact_unknown", "reason": "<真实 reason_code>", "reason_code": "<真实 reason_code>", "retryable": <bool>}
```

### structure-gate 非 fresh 返回（`evaluateStructureGate`）
```json
{"gate": "blocked", "reason": "<真实 reason_code>", "reason_code": "<真实 reason_code>", "retryable": <bool>, "httpStatus": <int>}
```

- `reason` (string, 必填): Mapper `freshness.reason_code` 的**字面透传**；来源——PRD 步骤 2/3/4「透传具体 reason_code」
- `reason_code` (string, 必填): 与 `reason` 同值，供 harness log 排查（PRD 步骤 4「reason / reason_code 字段为真实 reason_code」+ NFR 可观测）
- `retryable` (bool, 必填): `freshness.status === 'stale'` → `true`（瞬态可自愈）；`unknown` / 其它非 fresh / freshness 缺失 → `false`（确定性 fail-closed）
- **禁用值**: 当 `freshness.status` 非 fresh 且存在真实 reason_code（或 status=`unknown`/`stale`/freshness 缺失可推出确定性兜底码）时，`reason` / `reason_code` **绝不允许**是折叠常量 `"mapper_stale"`。`mapper_stale` 仅作为「已被本 sprint 删除的旧折叠值」出现在反向断言里。

### 确定性 reason_code 分类表（本 sprint 的核心设计，evaluator/generator 共识）

| 输入 `freshness` | `reason` / `reason_code` | `retryable` | 依据 |
|---|---|---|---|
| `{status:'stale', reason_code:'fact_snapshot_stale'}` | `fact_snapshot_stale` | `true` | 瞬态 stale，透传 |
| `{status:'stale', reason_code:'manifest_projection_mismatch'}` | `manifest_projection_mismatch` | `true` | 瞬态 stale，透传 |
| `{status:'unknown', reason_code:'impact_anchor_missing'}` | `impact_anchor_missing` | `false` | 确定性 unknown，fail-closed |
| `{status:'unknown', reason_code:'capability_not_in_active_projection'}` | `capability_not_in_active_projection` | `false` | 确定性 unknown，fail-closed |
| `{status:'stale'}`（reason_code 缺失） | `mapper_stale_unspecified` | `true` | 确定性兜底码，禁折叠回裸 `mapper_stale` |
| `{status:'unknown'}`（reason_code 缺失） | `mapper_unknown_unspecified` | `false` | 确定性兜底码 + fail-closed |
| `freshness` 缺失（null/undefined） | `mapper_freshness_missing` | `false` | 不可判定 → fail-closed |

> reason_code 枚举来源：`packages/brain/src/map/radius.js`（`stale`：`fact_snapshot_stale`/`projection_revision_missing`/`projection_revision_mismatch`/`manifest_projection_mismatch`；`unknown`：`impact_anchor_missing`/`capability_not_in_active_projection`/`graph_projection_revision_mismatch`/`unsafe_assertion_ref`/`assertion_identity_ambiguous`/`capability_assertion_coverage_missing`）。分流轴 = `freshness.status`（`stale`=瞬态可重试，`unknown`/其它=确定性 fail-closed）。改动 `structure-gate` 时 `buildBlockedResult` 的 `retryable` 由 httpStatus 推导，确定性分支须给非 `503/409` 状态码（建议 `422`）以得到 `retryable:false`。

---

## Golden Path

[Diff Impact Gate 被调用，Mapper 返回非 fresh] → [按 `freshness.status` 确定性分流] → [透传真实 reason_code 的正确 retryable 出口]

### Step 1: 入口 — 非 fresh 分支读取 freshness.status / reason_code
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 点（`freshness.status !== 'fresh'` 进入非 fresh 分支）

**可观测行为**: gate 在 Mapper 非 fresh 时不再一律返回 `mapper_stale`，而是依 `freshness.status` 与 `reason_code` 分流。

**验证命令**:
```bash
node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario transient --out /tmp/gp1.json >/dev/null 2>&1
jq -e '.reason=="fact_snapshot_stale" and .reason_code=="fact_snapshot_stale"' /tmp/gp1.json
```
**硬阈值**: `reason == "fact_snapshot_stale"` 且不等于 `"mapper_stale"`

---

### Step 2: 系统处理（瞬态 stale）— 透传 reason_code + retryable:true
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 点（瞬态 stale → `retryable:true` 且透传具体 reason_code）

**可观测行为**: `freshness.status === 'stale'` 的可自愈情形，`retryable:true`，`reason` 为真实码（非 `mapper_stale`）。

**验证命令**:
```bash
node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario transient2 --out /tmp/gp2.json >/dev/null 2>&1
jq -e '.retryable==true and .reason=="manifest_projection_mismatch"' /tmp/gp2.json
```
**硬阈值**: `retryable == true` 且 `reason == "manifest_projection_mismatch"`

---

### Step 3: 系统处理（确定性 unknown）— fail-closed + 透传 reason_code
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 点（确定性 unknown → `retryable:false` 且透传具体 reason_code，不再无限重试）

**可观测行为**: `freshness.status === 'unknown'`（如 `impact_anchor_missing`）→ `retryable:false`（终止重试循环），`reason` 为真实码。

**验证命令**:
```bash
node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario deterministic --out /tmp/gp3.json >/dev/null 2>&1
jq -e '.retryable==false and .reason=="impact_anchor_missing" and (.reason!="mapper_stale")' /tmp/gp3.json
```
**硬阈值**: `retryable == false` 且 `reason == "impact_anchor_missing"`（关键：修 mapper_stale 无限重试根因）

---

### Step 4: 可观测出口 + structure-gate 同构一致
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 点 + 「边界情况」structure-gate/diff-gate 同构

**可观测行为**: structure-gate 非 fresh 分支与 diff-gate 语义一致（瞬态 retryable:true 透传 / 确定性 retryable:false 透传），不产生跨脚本语义分叉。

**验证命令**:
```bash
node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate structure --scenario deterministic --out /tmp/gp4.json >/dev/null 2>&1
jq -e '.retryable==false and .reason=="impact_anchor_missing"' /tmp/gp4.json
```
**硬阈值**: structure-gate 确定性 unknown `retryable == false` 且 `reason == "impact_anchor_missing"`

---

### Step 5: 边界 — freshness 缺失 fail-closed，不静默判 retryable:true
**来源**: `[AI_ADDED]` — PRD「边界情况」第 2 点（freshness null → fail-closed）。理由：防 generator 只改有 reason_code 的分支、漏掉 freshness 缺失时仍折叠 retryable:true 的假绿面。

**可观测行为**: `freshness` 为 null/undefined → `retryable:false` 且 `reason` 为确定性兜底码（非 `mapper_stale`）。

**验证命令**:
```bash
node sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs --gate diff --scenario missing --out /tmp/gp5.json >/dev/null 2>&1
jq -e '.retryable==false and (.reason!="mapper_stale")' /tmp/gp5.json
```
**硬阈值**: `retryable == false` 且 `reason != "mapper_stale"`

---

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 现有断言：Mapper 抛异常 → `impact_unknown`/`retryable:true`；revision mismatch → `reason:'revision_mismatch'`；contract_missing → `retryable:false`。本 sprint **不得回退**这些既有 fail-closed 语义。
- [packages/brain/src/impact-contract/__tests__/structure-gate.test.js] → 现有断言 line148/158：`Mapper stale 响应包含 reason=mapper_stale` + `retryable=true`。**本 sprint 行为变更**：stale（如 `ttl_exceeded`）改为透传 `reason='ttl_exceeded'`、`retryable=true`——generator 必须同步更新该既有断言为透传值（属 PRD 范围内「同构一致性修正」，非回退）。
- [累积FR] （本 line 暂无已验收历史；context-manifest: PRD 声明本 line 无 done/working golden_path）
- [Unified Map] `[MAP_NOT_CONFIGURED]`：task.payload 未提供 map_scope/map_repo，无 must_run_assertions 注入。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | Diff/Structure Impact Gate 非 fresh 分支按 `freshness.status` 分流：瞬态 stale→retryable:true 透传 reason_code；确定性 unknown/缺失→retryable:false 透传/兜底 reason_code |
| **NFR（做得多好）** | 非功能 | 同步返回无新增外部调用；无新增延迟/频控（PRD NFR 待定，沿用现有 gate 同步路径） |
| **Invariant（永不违反）** | 不变量 | fail-closed：任何不可判定/缺失情形 `retryable:false`，绝不假绿判 retryable:true；diff-gate 与 structure-gate 同一语义同一处理策略 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表（freshness.status → retryable 的判定） |
| **保质期（何时过期）** | 失效退役 | N/A — 纯确定性分类逻辑，无 token/缓存时效 |
| **死亡告警（停了谁知道）** | 告警 | 确定性 unknown 若被误判 retryable:true → harness run 出现 `deny:impact:<code>` 无限重试空转（正是本 sprint 消除的现象）；harness orchestrator 重试计数/日志即告警面 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | gate 返回对象即回执：`reason`/`reason_code`/`retryable` 三字段被探针 jq -e 断言；确定性情形 `retryable:false` 真实终止 orchestrator 重试 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | API 不稳 | 静默丢消息 |
| ⚠️ freshness 是否可通过重试自愈（瞬态 vs 确定性） | A. 按 `freshness.status`（stale=瞬态/unknown=确定性）; B. 按 reason_code 前缀白名单; C. 一律 retryable:true（现状 bug） | A. 按 `freshness.status` 分流 | radius.js 已用 `status:'stale'` 标瞬态、`status:'unknown'` 标确定性不可判定；gate 只需按 status 分流透传（PRD ASSUMPTION） | 误判确定性为 retryable → 无限重试空转（f62c7e87/d1360a48 实证）；误判瞬态为 fail-closed → 本可自愈的 run 被过早终止 |
| freshness 缺失 / reason_code 缺失时的兜底 | A. fail-closed(retryable:false)+确定性兜底码; B. 折叠回 mapper_stale(retryable:true) | A | PRD 边界情况：缺失按不可判定处理，禁静默 retryable:true | 折叠回 mapper_stale → 缺失信息也无限重试 |

> ⚠️ 判定点「freshness.status 分流轴」误判后果严重（无限重试空转 / 过早终止）。PrepPRD 已在 ASSUMPTION 中拍板「按 radius.js 的 status/reason_code 分流，gate 不重算」，故不再升级用户；如 Reviewer 认为 `stale` 之外仍有可重试的 `unknown` 子类，需回 PRD 来源确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 确定性 unknown（impact_anchor_missing 等） | gate 返回 `impact_unknown`/`blocked` + `retryable:false` | 是（纯函数，同输入同输出） | orchestrator 依 `retryable:false` 终止重试，交人工/上游修 anchor |
| 瞬态 stale（fact_snapshot_stale 等） | gate 返回 `retryable:true` + 透传 reason_code | 是 | orchestrator 重试，等 Mapper 自愈 |
| freshness / reason_code 缺失 | fail-closed `retryable:false` + 确定性兜底码 | 是 | 不静默放行，终止重试 |
| Mapper 不可达（抛异常） | 维持既有 `mapper_unavailable`/`retryable:true`（PRD 边界情况 1，本 sprint 不改） | 是 | 重试等 Mapper 恢复 |

### 输入对抗面

N/A — gate 为 Brain 内部函数，输入来自可信上游 Mapper（radius.js），非对外暴露 agent，无 prompt injection / 越权指令面。

---

## 禁 mock 边清单

本单涉及**状态机/判定分流**（freshness.status → retryable 的确定性裁决），按 v9.12 硬规则：failing test 必须跑真实 gate 代码，不 mock 被改的那条边。

- 代码（gate 内部分类逻辑）↔ 自身：`evaluateDiffGate` / `evaluateStructureGate` 的非 fresh 分类分支**禁 mock**——回归测试与探针必须直调真实 gate 函数，断言其真实返回对象（当前 tests 与 e2e/gate-probe.mjs 均如此）。
- 允许 mock 的**外层无关依赖**：`mapClient`（Mapper/radius.js 的注入替身）——PRD「范围限定/假设」明确 radius.js 的 `freshness.reason_code` 为**可信输入、不在本 sprint 范围**，gate 只按其分流透传；注入 mapClient 是喂 gate 输入、不是替换被改的边（现有 diff-gate.test.js/structure-gate.test.js 亦以注入 mapClient 为既定测试缝）。`db` 传 null（非 fresh 分支在触 DB 前返回，无 DB 写路径参与本改动）。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api，纯 node 直调 gate，无 Postgres）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 改动的非 fresh 分支在 gate 触 DB 前返回，Postgres 非必需（runtime_resources.postgres=false 一致）。探针 import 会触发 db.js 打印 pool 配置到 stdout（不连库），故结果写文件、assertion 用 jq 读文件，不解析 stdout。
> vitest 工作目录死规则（9.25.0）：跑 `packages/brain/src/**` 下的回归测试必须 `(cd packages/brain && npx vitest run --no-cache ...)` 子 shell，禁从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail
PROBE="sprints/08191417-kernel-4ab267a7/e2e/gate-probe.mjs"
OUT=/tmp/e2e-gate
mkdir -p "$OUT"

run() { # gate scenario
  node "$PROBE" --gate "$1" --scenario "$2" --out "$OUT/$1-$2.json" >/dev/null 2>&1
}

# 1. diff 瞬态 stale → 透传 reason_code + retryable:true（非 mapper_stale）
run diff transient
jq -e '.retryable==true and .reason=="fact_snapshot_stale" and .reason_code=="fact_snapshot_stale"' "$OUT/diff-transient.json" \
  || { echo "FAIL: diff 瞬态未透传 reason_code"; exit 1; }

# 2. diff 确定性 unknown → fail-closed retryable:false + 透传 reason_code（核心根因）
run diff deterministic
jq -e '.retryable==false and .reason=="impact_anchor_missing" and (.reason!="mapper_stale")' "$OUT/diff-deterministic.json" \
  || { echo "FAIL: diff 确定性 unknown 仍 retryable 或未透传"; exit 1; }

# 3. diff freshness 缺失 → fail-closed retryable:false，不折叠回 mapper_stale
run diff missing
jq -e '.retryable==false and (.reason!="mapper_stale")' "$OUT/diff-missing.json" \
  || { echo "FAIL: diff freshness 缺失未 fail-closed"; exit 1; }

# 4. diff reason_code 缺失但 status=unknown → 确定性兜底码 + retryable:false
run diff code_missing_unknown
jq -e '.retryable==false and (.reason!="mapper_stale") and (.reason|length>0)' "$OUT/diff-code_missing_unknown.json" \
  || { echo "FAIL: diff reason_code 缺失未给确定性兜底"; exit 1; }

# 5. structure 瞬态 stale → 透传 + retryable:true（同构一致）
run structure transient
jq -e '.retryable==true and .reason=="fact_snapshot_stale"' "$OUT/structure-transient.json" \
  || { echo "FAIL: structure 瞬态未透传"; exit 1; }

# 6. structure 确定性 unknown → fail-closed retryable:false + 透传（同构一致，语义不分叉）
run structure deterministic
jq -e '.retryable==false and .reason=="impact_anchor_missing"' "$OUT/structure-deterministic.json" \
  || { echo "FAIL: structure 确定性 unknown 与 diff 语义分叉"; exit 1; }

# 7. 永久回归测试在真实测试文件里全绿（子 shell 进 packages/brain，禁从仓库根跑）
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/structure-gate.test.js ) \
  || { echo "FAIL: 永久回归测试未全绿"; exit 1; }

echo "✅ Golden Path 验证通过：mapper_stale 折叠已拆分为瞬态透传 + 确定性 fail-closed"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness={status:'weird_unhandled'}`（既非 fresh 也非 stale/unknown 的未知 status）→ 应按确定性 fail-closed（retryable:false），不得漏判为 retryable:true
- 错输入: `freshness={status:'stale', reason_code:''}`（空字符串 reason_code）→ 应给确定性兜底码，不得输出空 reason
- 重复提交: 同一 freshness 连续两次调 gate → 纯函数应完全一致（幂等）
- 中途中断: N/A（同步纯函数，无中断点）
- 边界值: radius.js 全部 `unknown` 枚举（`unsafe_assertion_ref`/`assertion_identity_ambiguous`/`capability_assertion_coverage_missing`/`graph_projection_revision_mismatch`）→ 均应 retryable:false 透传；全部 `stale` 枚举 → 均应 retryable:true 透传
发现分级: P0/P1（确定性情形被判 retryable:true → 无限重试空转复现）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 瞬态透传 | `tests/gate-reason-passthrough.test.ts` | `瞬态 stale 透传 reason_code 且 retryable` | → 现状返回 mapper_stale，assert fail |
| diff-gate 确定性 fail-closed | `tests/gate-reason-passthrough.test.ts` | `确定性 unknown fail-closed retryable false` | → 现状 retryable:true，assert fail |
| structure-gate 同构 | `tests/gate-reason-passthrough.test.ts` | `structure-gate 确定性 unknown 与 diff 一致` | → 现状 mapper_stale/retryable:true，assert fail |
| freshness 缺失兜底 | `tests/gate-reason-passthrough.test.ts` | `freshness 缺失 fail-closed 不折叠 mapper_stale` | → 现状折叠 mapper_stale，assert fail |
