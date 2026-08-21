# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 reason_code + 确定性终态 fail-closed 出口（r19/r38）

锚定父路声明：独立小路（无父路）—— journey e6f803f2 的 golden-paths 均为 planned，无 done/working 历史（PRD「累积 FR：本 line 暂无历史」）。本 sprint 为 harness kernel 内部门禁修复。

gp-anchor: skipped (product-map.json not found)

contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），代码层 Contract Gate 生效，本合同断言按速查表惯用法书写。

---

## Response Schema（推导来源: PRD 字面 + 源码 evaluateDiffGate/evaluateStructureGate 返回结构）

本 sprint 无 HTTP 端点新增；改动对象是两个内部门禁函数的返回对象 shape。

### 函数: `evaluateDiffGate(...)` → Promise<object>（packages/brain/src/impact-contract/diff-gate.js）
不可判定分支返回：
```json
{"gate": "impact_unknown", "reason": "<具体 reason_code>", "retryable": <boolean>}
```
- `gate` (string, 必填): 不可判定时固定 `"impact_unknown"`（源码既有）
- `reason` (string, 必填): **具体 reason_code**，取值 ∈ `mapper_unavailable` / `db_unavailable` / `mapper_stale` / `revision_evidence_missing` / `revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch` / `<Mapper 透传的未枚举 reason>`。禁止把终态折叠成笼统 `mapper_stale`。
- `retryable` (boolean, 必填): 瞬态=`true`，确定性终态 / 未知 reason=`false`（fail-closed 出口）

### 函数: `evaluateStructureGate(...)` → Promise<object>（packages/brain/src/impact-contract/structure-gate.js）
blocked 分支返回：
```json
{"gate": "blocked", "reason": "<具体 reason_code>", "retryable": <boolean>, "httpStatus": <number>}
```
- 同源对齐：`retryable` 不再单纯由 httpStatus（503/409）推导，而是按 reason 分流（终态 `revision_mismatch` → `retryable:false`）。

**禁用字段名**: 无（不改字段名，仅改 `retryable` 取值语义 + `reason` 透传）。PRD 是法律——`reason` / `retryable` / `gate` 字面名不变。

**Error**: 本改动无独立 error response 形态；不可判定即以上 blocked/impact_unknown 结构表达。

---

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] `Mapper revision mismatch 时 Diff Gate 返回 blocked` → 现断言 `retryable:true`，**本 sprint 需翻转为 false**（终态）。
- [diff-gate.test.js] `同一 base revision 的 projection digest 漂移时刷新合同版本` → 现断言 `manifest_digest_mismatch, retryable:true`，**需翻转为 false**。
- [diff-gate.test.js] `fact_revisions 缺少目标 repo 时返回 impact_unknown` → `revision_evidence_missing, retryable:true`，**保持不变**（瞬态）。
- [structure-gate.test.js] `revision mismatch 响应包含 retryable=true` → **需翻转为 false**（终态，同源对齐）；`Mapper unavailable/stale 响应包含 retryable=true` **保持不变**（瞬态）。
- [累积FR] context-manifest: unavailable（无 DB / Brain，端点不可达；PRD 声明本 line 暂无历史）。
- [loop.js 既有机制] `orchestrator/loop.js:1661-1664` 已存在 fail-closed 终态出口：`impactGateReceipt.retryable === false` → `failure_class:'impact_contract_invalid'` → `failRun('impact_gate_deterministic:...')` 并 return（不回队）；`infrastructure_blocked` → backoff+continue（重派）。**因此 loop.js 无需改动**——本 sprint 只需让 Gate 对终态发出 `retryable:false`，既有出口即生效。这是本 sprint 不修改编排层的关键依据（见范围限定）。

---

## 历史约束三源加载

1. **铁律清单 → INV 覆盖**（见 contract-dod.md INV-* 条目逐条映射）。
2. **累积 FR**：context-manifest 端点不可达（无 Brain/DB），PRD 明示本 line 无 done/working 历史 → 无可回退行为。
3. **回归测试约束**：见上「已知约束」。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | Diff/Structure Gate 对 Mapper 不可判定结论透传具体 reason_code；确定性终态（稳定 digest/revision mismatch、未知 reason）走 fail-closed 出口 `retryable:false`；瞬态保持 `retryable:true` |
| **NFR（做得多好）** | 非功能 | 重试边界：确定性终态必须一次性终止不空转；可观测：deny 事件携带具体 reason_code（`deny:impact:<具体>`）|
| **Invariant（永不违反）** | 不变量 | fail-closed：任何真正不可判定情形仍返回 blocked/impact_unknown，绝不假绿放行（不得因新增 fail-closed 分流而误放行 pass/extend）|
| **判定点（怎么知道）** | 见判定点登记表 | 见下 |
| **保质期（何时过期）** | 失效 | 不适用（纯分类逻辑，无 token/凭据/时效数据）N/A |
| **死亡告警（停了谁知道）** | 告警 | 终态 deny 经 loop.js failRun 落 run 失败态 + 具体 reason_code，主理人经 run 归因可见；无新增告警通道 N/A |
| **失败语义（挂了怎么办）** | 见失败语义声明 | 见下 |
| **效果确认（已发≠已生效）** | 回执 | vitest 断言 Gate 返回对象 reason/retryable；终态出口最终由 loop.js 既有 failRun 落库（本 sprint 不改 loop）|

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 某 reason_code 是「瞬态」还是「确定性终态」 | A. 由 Mapper 显式区分字段；B. Gate 侧按 reason 枚举白名单静态分流 | B. 按 reason 枚举白名单静态分流（瞬态白名单：mapper_unavailable/db_unavailable/mapper_stale/revision_evidence_missing/git_diff_unavailable/contract_extend_write_failed/gap_ledger_write_failed；其余含未知=终态 fail-closed）| PRD 假设「若 Mapper 未提供区分，则按 reason 枚举白名单静态分流」；白名单外一律保守 fail-closed，避免瞬态被误终态 | 瞬态误判终态→过早 fail-closed 令可恢复 attempt 直接失败；终态误判瞬态→回到无限重试空转（本 bug 根因）|
| 未知/未枚举 reason_code 的默认档 | A. 默认可重试；B. 默认 fail-closed | B. 默认 fail-closed（retryable=false）并透传原始 reason | PRD 边界情况：「未知 reason_code 默认按 fail-closed 保守处理，不假绿」| 默认可重试→新型终态 mismatch 继续空转 |

> ⚠️ 行说明：瞬态/终态白名单是主动请教级判定点——白名单成员由本合同固化（见 contract-dod.md INV/BEHAVIOR），若后续 Mapper 新增 reason 需回到本表评估归档。judgment-pending-user: 无（白名单取值与 PRD 边界情况逐条对应，PrepPRD 已隐含拍板）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper 不可达 / DB 不可达（瞬态）| 返回 impact_unknown/blocked + retryable=true | 是（同输入同判定）| loop.js infrastructure_blocked backoff 重派 |
| 稳定 digest/revision mismatch（终态）| 返回 impact_unknown/blocked + 具体 reason + retryable=false | 是（同输入同判定，终态确定）| loop.js impact_contract_invalid → failRun 终止，不重派 |
| 未知 reason_code | 透传原始 reason + retryable=false（fail-closed）| 是 | 同终态路径终止 |

### 输入对抗面

N/A —— 本改动是 harness kernel 内部门禁分类逻辑，无对外暴露 agent 输入面；Mapper 结论来自内部可信 Map 服务。

---

## 禁 mock 边清单

本单改动 = Gate 内部「reason → retryable」分类逻辑（纯逻辑，作用于 mapperResult），属状态机/裁决判定类，故列禁 mock 边：

- **Gate 分类逻辑本体（diff-gate.js / structure-gate.js 的 reason/retryable 判定）**：测试必须真实执行该分类路径，禁止 stub/mock 掉被改函数的裁决分支——断言对象是 `evaluateDiffGate`/`evaluateStructureGate` 真实返回的 `reason`/`retryable`。
- **允许注入的外层边界**：`mapClient`（Mapper HTTP 服务，本 sprint 未改，是既有回归测试同款注入 seam）、`db.query`（仅用于加载 active contract；终态分支在任何 DB 写入前 return，未触及 DB 写路径）。这两者是「更外层无关依赖」，非被改的边。
- **DB 写路径**：本 sprint 终态/瞬态分流分支均在副作用（recordDriftAndBlockTask / persistContract）之前 return，**不改任何 DB 写路径**，故无 code↔DB 写边需真 Postgres；契约测试无需 brain-integration job。

---

## Golden Path

系统（Harness Diff Impact Gate）从 [收到 Mapper 确定性结论] → [按 reason_code 分流瞬态/终态] → [透传具体 reason_code 并对终态 fail-closed 终止空转]

### Step 1: Gate 收到 Mapper 确定性终态结论（稳定 digest/revision mismatch）
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 1-2「透传 + 分流」、范围限定第 1/2 条。

**可观测行为**: `evaluateDiffGate` 对稳定 `projection_digest_mismatch`/`manifest_digest_mismatch`/`revision_mismatch` 返回 `{gate:'impact_unknown', reason:<该具体 code>, retryable:false}`——reason 不折叠成 `mapper_stale`，retryable 为 false。

**验证命令**:
```bash
npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "终态 projection_digest_mismatch" --reporter=basic
# 期望：exit 0（修复后），reason=projection_digest_mismatch 且 retryable=false
```

**硬阈值**: reason === 具体 code 且 retryable === false（vitest exit 0）
```bash
npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "终态" --reporter=basic
```

---

### Step 2: Gate 收到基础设施类瞬态结论（Mapper 不可达 / stale / evidence missing）
**来源**: `[FROM_PRD]` — PRD 边界情况「瞬态 vs 终态误判」、范围限定「不改瞬态退避曲线」。

**可观测行为**: `mapper_unavailable`/`mapper_stale`/`revision_evidence_missing`/`db_unavailable` 返回 `retryable:true`，绝不被误判为终态过早 fail-closed。

**验证命令**:
```bash
npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "瞬态" --reporter=basic
# 期望：exit 0，mapper_unavailable/mapper_stale/revision_evidence_missing 均 retryable=true
```

**硬阈值**: 三条瞬态用例 reason 具体且 retryable === true（vitest exit 0）

---

### Step 3: 透传 Mapper 具体 reason_code（含 freshness 携带 reason_code）+ 未知 reason fail-closed
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 2「透传」、边界情况「未知 reason_code 默认 fail-closed 并透传」。

**可观测行为**: 当 Mapper freshness 携带具体 `reason_code`（如 `projection_digest_mismatch`）时，Gate 透传该 reason（不折叠成 `mapper_stale`）且按终态判 retryable=false；未枚举的新 reason 透传原文且 retryable=false（保守 fail-closed）。

**验证命令**:
```bash
npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "透传" --reporter=basic
npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "未知" --reporter=basic
# 期望：exit 0，reason 为透传的原始具体 code，retryable=false
```

**硬阈值**: reason === Mapper 原始 reason_code 且 retryable === false（vitest exit 0）

---

### Step 4: structure-gate 同源折叠对齐（终态不再折叠 mapper_stale、retryable=false）
**来源**: `[FROM_PRD]` — PRD 边界情况「structure-gate 同源折叠」、范围限定第 3 条。

**可观测行为**: `evaluateStructureGate` 对确定性终态 `revision_mismatch` 返回 `retryable:false`；瞬态 `mapper_stale`/`mapper_unavailable` 保持 `retryable:true`；`buildBlockedResult` 的 retryable 不再单纯由 httpStatus 推导。

**验证命令**:
```bash
npx vitest run sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js -t "Structure Gate" --reporter=basic
# 期望：exit 0，structure-gate revision_mismatch retryable=false，mapper_stale/unavailable retryable=true
```

**硬阈值**: structure-gate 终态 retryable === false、瞬态 retryable === true（vitest exit 0）

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯 vitest 单测 oracle）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 是 harness kernel 内部门禁纯逻辑改动（reason→retryable 分类），环境无关（逻辑断言）。runtime_resources.postgres=false 且无运行中 Brain（localhost:5221 依赖 DB），故 oracle 为从仓库根跑 sprints/** 冻结 vitest（skill 允许 sprints/**、tests/** 从仓库根 `npx vitest run`）。终态出口的编排层落库由 loop.js:1661-1664 既有机制承接（本 sprint 不改 loop）。接缝清单为空（见下）。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

FROZEN="sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js"

# 1. 冻结回归全量：透传 + 分流 + 终态 fail-closed + structure-gate 同源，全部通过
npx vitest run "$FROZEN" --reporter=basic

# 2. 关键场景定点复核：确定性终态 retryable=false
npx vitest run "$FROZEN" -t "终态" --reporter=basic

# 3. 瞬态保持可重试（不被误判为终态）
npx vitest run "$FROZEN" -t "瞬态" --reporter=basic

# 4. structure-gate 同源对齐
npx vitest run "$FROZEN" -t "Structure Gate" --reporter=basic

# 5. 既有 impact-contract 回归不破（生成侧翻转 retryable 后旧测试需同步更新，全绿）
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/structure-gate.test.js)

echo "✅ Diff Impact Gate 透传 + 终态 fail-closed 验收通过"
```

> vitest 工作目录死规则遵循：sprints/** 冻结测试从仓库根跑（root vitest.config include 覆盖 sprints/**）；packages/brain/src/** 既有回归用子 shell `(cd packages/brain && npx vitest run ./src/...)` 走该包自己的 vitest 配置。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `evaluateDiffGate` 的 mapperResult.freshness 为 `undefined` / `null` / `{status:'fresh'}` 但 `reason_code` 缺失 → 应回落 `mapper_stale`（瞬态），不得崩溃
- 重复提交: 同一终态输入连续两次调用 → 两次均 retryable=false 且 reason 一致（幂等，确定性终态）
- 中途中断: mapperResult 同时命中多个 mismatch（manifest + projection 同时漂移）→ 按源码检查顺序返回首个具体 reason（manifest 先于 projection），仍 retryable=false
- 边界值: 瞬态白名单成员逐一确认 retryable=true；白名单外任意字符串 reason → retryable=false
发现分级: P0/P1（瞬态被误判终态令可恢复 attempt 直接失败 / 终态被误判瞬态继续空转）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## 接缝清单

（本 sprint 纯 harness kernel 内部分类逻辑改动，环境无关，无真机 / 生产 env / 真实调用方接缝——全部为逻辑断言，CI/单测绿 = 真 done。接缝清单为空，理由：无碰真实世界的点。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A —— 被改的分类逻辑真实执行，mapClient/db 为既有回归测试同款外层注入 seam，非 force_*/假数据顶替真实链路。）

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Diff Gate 确定性终态 fail-closed + 透传 | `sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js` | 终态 projection_digest_mismatch；终态 manifest_digest_mismatch；终态 revision_mismatch；瞬态；透传；未知；Structure Gate | 当前 6 failed / 5 passed（exit 1）——终态/透传/未知/structure 终态 RED，瞬态 5 条 GREEN（分流基线，不得回退）|
| 既有 impact-contract 回归（补充行）| `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | manifest_digest_mismatch retryable 翻转；revision mismatch retryable 翻转 | 旧断言 retryable:true 需同步改 false 后全绿 |
| 既有 structure-gate 回归（补充行）| `packages/brain/src/impact-contract/__tests__/structure-gate.test.js` | revision mismatch retryable 翻转 | 旧断言 retryable:true 需同步改 false 后全绿 |

> Test File 死规则遵循：至少一行本 sprint 冻结测试（`sprints/08211504-kernel-e9e0db8f/tests/diff-impact-gate-reason-passthrough.test.js`，已落盘并将进 commit）；`packages/...` 既有测试仅作补充行。BEHAVIOR 覆盖名均为对应 test() 名的字面子串。
