# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 mapper reason_code + 确定性结论 fail-closed 出口

**锚定父路声明**: 独立小路（无父路）—— 本 sprint 是 harness 内部裁决缺陷修复（Diff Impact Gate 步骤 3a），journey golden-paths 现存 ability 均为 planned 态，未纳入累积 FR（PRD 已述）。

**journey_type**: autonomous
**target_environment**: local_api
**target_environment_reason**: 改动仅 `packages/brain/src/impact-contract/diff-gate.js` 纯后端裁决函数（`evaluateDiffGate` 步骤 3a）；oracle 为 node/vitest 直跑该函数 + 断言返回值，无 UI / 无真机 / 无第三方。

> **运行资源说明**: `runtime_resources.postgres=false`。本 sprint 被测分支（步骤 3a：mapper 非 fresh 裁决）在任何 `db.query` **之前**返回，故 oracle 用 `db=undefined` + 注入 `mapClient` 即可完整覆盖，**不需要 Postgres**。真实 mapper HTTP 客户端另有 `map-client.test.js` 回归，本单不触碰其计算逻辑。

## Response Schema（推导来源: PRD 字面 + 现有函数返回契约；registry 为内部函数无 HTTP 端点）

**N/A — 任务无 HTTP 响应**（本单是 Brain 内部裁决函数 `evaluateDiffGate` 的返回对象改动，非新增/修改 HTTP 端点）。

被测函数返回契约（`evaluateDiffGate(...) => object`，仅约束步骤 3a「mapper 非 fresh」分支）：

```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": false}
```

- `gate` (string, 必填): 固定 `"impact_unknown"`（沿用既有 fail-closed 语义，**不新增 gate 枚举值** — PRD 假设②）。来源: PRD 明确。
- `reason` (string, 必填): 透传自 `mapperResult.freshness.reason_code`（如 `"capability_not_in_active_projection"`）；`reason_code` 为 null/缺失时回退常量 `"mapper_stale"`（避免 `deny:impact:null`）。来源: PRD 步骤 2「不再被替换成常量字符串」。
- `reason_code` (string|null, 必填): **字面透传** `mapperResult.freshness.reason_code`；缺失为 `null`。来源: PRD 步骤 2。
- `retryable` (boolean, 必填): 仅当 `reason_code ∈ 瞬态白名单` 时为 `true`；终态结论与 null/缺失一律 `false`（fail-closed 非重试出口）。来源: PRD 步骤 2 + 边界情况「禁未知即重试」。
**禁用字段名/写法**: 终态结论输出 `reason: "mapper_stale"` + `retryable: true`（这正是空转根因，禁止复发）；`reason_code` 被替换成常量字符串。

## 瞬态 vs 终态 freshness.reason_code 分类（显式白名单 — PRD 要求，[status枚举全grep] 铁律）

权威来源: `packages/brain/src/map/radius.js`（`baseFreshness` + 后续 freshness 重写点）逐一 grep 锁定。`mapperResult.freshness.reason_code` 只可能取以下值：

| reason_code | freshness.status | 分类 | retryable | 依据 |
|---|---|---|---|---|
| `fact_snapshot_stale` | stale | **瞬态** | **true** | fact 快照刷新在途，重试可自愈（PRD「瞬态仅 fact 快照刷新在途一类」） |
| `projection_revision_missing` | stale | 终态 | false | projection 无 revision 记录，重试不自愈 |
| `projection_revision_mismatch` | stale | 终态 | false | revision 已错位，需新投影/合同 |
| `manifest_projection_mismatch` | stale | 终态 | false | manifest 与 projection digest 不一致 |
| `graph_projection_revision_mismatch` | unknown | 终态 | false | 图快照 revision 与投影不一致 |
| `capability_not_in_active_projection` | unknown | 终态 | false | 能力不在活跃投影，PRD Golden Path 主例 |
| `impact_anchor_missing` | unknown | 终态 | false | 变更文件无 anchor，重试不自愈 |
| `unsafe_assertion_ref` | unknown | 终态 | false | 断言引用不安全，需修数据 |
| `assertion_identity_ambiguous` | unknown | 终态 | false | 断言身份歧义，需修数据 |
| `capability_assertion_coverage_missing` | unknown | 终态 | false | 断言覆盖缺失，需补断言 |
| `null` / 缺失 | stale/unknown | 兜底终态 | false | 禁「未知即重试」导致空转复发（PRD 边界情况） |

**分类实现方式（显式白名单，fail-closed 默认）**: diff-gate.js 新增模块常量
`const TRANSIENT_FRESHNESS_REASON_CODES = new Set(['fact_snapshot_stale'])`；
步骤 3a 判定 `retryable = TRANSIENT_FRESHNESS_REASON_CODES.has(freshnessReasonCode)`。
白名单命中→重试；**其余一切（含 null/缺失/未知新增值）→ 非重试**，满足「未知即不重试、不空转、不假绿」三重铁律。
新增/变更瞬态白名单成员时，须与 `map/radius.js` 的 `baseFreshness` 枚举全仓 grep 同步（[status枚举全grep]）。

## Golden Path

[某 harness run 进入 Diff Impact Gate] → [mapper 返回非 fresh + 具体 reason_code] → [diff-gate 步骤 3a 透传 reason_code 并按白名单判 retryable] → [终态直接 fail-closed 非重试出口，run 停机不空转]

### Step 1: 触发 — mapper 返回非 fresh + 具体 reason_code
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步。

**可观测行为**: `evaluateDiffGate` 收到 `mapperResult.freshness = {status:'unknown', reason_code:'capability_not_in_active_projection'}`（终态）。

**验证命令**:
```bash
(cd packages/brain && node --input-type=module -e 'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db: undefined, taskId: "s1", headRevision: "deadbeef", changedFiles: ["a.js"], mapClient: async () => ({ freshness: { status: "unknown", reason_code: "capability_not_in_active_projection" }, fact_revisions: {}, affected_nodes: [], required_assertions: [] }) }); const ok = r.gate === "impact_unknown"; process.exit(ok ? 0 : 1);')
# 期望：exit 0（gate=impact_unknown）
```
**硬阈值**: `gate === "impact_unknown"`。

---

### Step 2: 系统处理 — 透传 reason_code + 终态 fail-closed 非重试
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（透传 + 终态 retryable:false + 瞬态保持 retryable:true）。

**可观测行为**: 终态结论 → `reason_code` 字面透传 + `retryable=false`；真瞬态 `fact_snapshot_stale` → `retryable=true`。

**验证命令**:
```bash
# 终态：retryable=false 且 reason_code 透传（非裸 mapper_stale）
(cd packages/brain && node --input-type=module -e 'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db: undefined, taskId: "s2a", headRevision: "deadbeef", changedFiles: ["a.js"], mapClient: async () => ({ freshness: { status: "unknown", reason_code: "capability_not_in_active_projection" }, fact_revisions: {}, affected_nodes: [], required_assertions: [] }) }); const ok = r.retryable === false && r.reason_code === "capability_not_in_active_projection" && r.reason !== "mapper_stale"; process.exit(ok ? 0 : 1);')
# 期望：exit 0
# 瞬态：retryable=true 保持
(cd packages/brain && node --input-type=module -e 'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db: undefined, taskId: "s2b", headRevision: "deadbeef", changedFiles: ["a.js"], mapClient: async () => ({ freshness: { status: "stale", reason_code: "fact_snapshot_stale" }, fact_revisions: {}, affected_nodes: [], required_assertions: [] }) }); const ok = r.retryable === true && r.reason_code === "fact_snapshot_stale"; process.exit(ok ? 0 : 1);')
# 期望：exit 0
```
**硬阈值**: 终态 `retryable===false && reason_code==='capability_not_in_active_projection'`；瞬态 `retryable===true && reason_code==='fact_snapshot_stale'`。

---

### Step 3: 出口 — 空转根因关闭（无确定性结论被判 retryable=true 的 mapper_stale）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 边界情况「reason_code 缺失也 fail-closed 兜底」。

**可观测行为**: reason_code 缺失/未知 non-fresh → `retryable=false`；既有 fresh→pass 路径不回退（全套 diff-gate 测试仍绿）。

**验证命令**:
```bash
# 缺失 reason_code non-fresh → fail-closed retryable=false
(cd packages/brain && node --input-type=module -e 'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const r = await evaluateDiffGate({ db: undefined, taskId: "s3", headRevision: "deadbeef", changedFiles: ["a.js"], mapClient: async () => ({ freshness: { status: "unknown" }, fact_revisions: {}, affected_nodes: [], required_assertions: [] }) }); const ok = r.gate === "impact_unknown" && r.retryable === false && (r.reason_code ?? null) === null; process.exit(ok ? 0 : 1);')
# 期望：exit 0
# 既有行为不回退：diff-gate 全套单测（含 fresh→pass/extend/drift 与 revision mismatch）仍全绿
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js 2>&1 | grep -qE "Test Files[[:space:]]+1 passed") || { echo "FAIL: diff-gate 回归套件未全绿"; exit 1; }
# 期望：exit 0
```
**硬阈值**: 缺失 reason_code → `retryable===false`；diff-gate.test.js `Test Files 1 passed`。

---

## 已知约束（来自回归测试 + 累积FR + Unified Map）

- [回归测试] `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`（现 20 tests 全绿）：fresh→pass（`reason_code===null`）、extend、drift（`reason_code==='CONTRACT_IMPACT_DRIFT'`）、revision_evidence_missing→impact_unknown+retryable:true、manifest_digest_mismatch→retryable:true、mapper 抛异常→impact_unknown+retryable:true。**本单只改步骤 3a（freshness 非 fresh 折叠点），上述分支语义一律不得回退。**
- [累积FR] 本 line 暂无已验收 ability 历史（journey golden-paths 均 planned 态）。context-manifest 端点未在本轮拉取（postgres:false，Brain DB 依赖不保证）：`context-manifest: unavailable`。
- [Unified Map] `[MAP_NOT_CONFIGURED]` — PRD 记 map_scope=F1 但 payload 缺 map_repo，Unified Map 未配置；`must_run_assertions` 为空，不做领域硬编码猜测。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | diff-gate 步骤 3a：透传 `mapperResult.freshness.reason_code` 到返回结果；终态 reason_code（及 null/缺失）→ `retryable:false` fail-closed 非重试出口；真瞬态 `fact_snapshot_stale` → 保持 `retryable:true`。 |
| **NFR（做得多好）** | 非功能 | 不新增阻塞式等待/重试频控参数（PRD NFR）；判定为纯内存 O(1) set 查询，无额外 IO。 |
| **Invariant（永不违反）** | 不变量 | [fail-closed] 任何不可判定情形返回 impact_unknown 且非重试兜底，绝不假绿；不新增 gate 枚举值（PRD 假设②）；瞬态白名单与 map/radius.js 枚举全 grep 同步（[status枚举全grep]）。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表。 |
| **保质期（何时过期）** | 失效 | 瞬态白名单随 map/radius.js `baseFreshness` 枚举演进；新增 freshness reason_code 时须复核归类（否则默认落入终态 fail-closed，安全侧）。 |
| **死亡告警（停了谁知道）** | 告警 | fail-closed deny 携带真实 reason_code 进 `gateVerdict = deny:impact:<reason_code>`（loop.js:1454）+ Brain log，run 以确定性 BLOCKED（failure_class=impact_contract_invalid）终止，可溯源。 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执 | 返回对象即回执；终态 run 停机 = 不再出现 `deny:impact:mapper_stale` 无限重排。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ 某 freshness.reason_code 是终态还是瞬态 | A. 黑名单终态（未知即重试）; B. 白名单瞬态（未知即不重试/fail-closed） | **B. 白名单瞬态** | PRD 明令「禁未知即重试导致空转复发」+ [fail-closed] 铁律，安全侧默认非重试 | 若误判：终态被当瞬态→无限重试空转（原 bug 复发）；瞬态被当终态→run 过早停机需人重触发（危害更小，可接受的 fail-closed 偏保守） |

> ⚠️ 行说明：该判定点误判后果为「run 空转需人介入」（原 bug）或「过早停机」，属需谨慎项；PRD 步骤 2 已明确白名单方向，PrepPRD 已拍板，无需再升级用户确认。`judgment-pending-user: 无`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 终态 reason_code | 返回 impact_unknown + retryable:false，run 确定性 BLOCKED 停机 | 是（同结论稳定，重触发仍同判定） | 无重试；携带 reason_code 供人工/上游溯源 |
| 瞬态 fact_snapshot_stale | 返回 impact_unknown + retryable:true，交由既有重排机制 | 是 | 既有重试（本单不改重试机制） |
| reason_code 缺失/未知新增值 | fail-closed 兜底 retryable:false | 是 | 安全侧非重试，防空转 |
| mapper 抛异常（不可达） | 既有 `mapper_unavailable` + retryable:true（本单不改此瞬态路径） | 是 | 既有行为 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本单为 Brain 内部裁决函数，输入来自受信 mapper 结果，无对外暴露 agent / 无外部用户可写入接口。

## 禁 mock 边清单

本单改动涉及「跨模块数据传递」（mapper → diff-gate 的 `freshness.reason_code` 解读）与「状态机」（gate 裁决 retryable 语义），必须列明：

- **diff-gate ↔ mapper 返回契约的 `freshness.reason_code` 字段**：被测的是 diff-gate 对该字段的**分类裁决逻辑**（步骤 3a），此逻辑在测试中**真实执行、不得 mock/stub**（不得 `vi.mock('../diff-gate.js')`、不得桩掉 `evaluateDiffGate` 内部分支）。测试仅通过既有 DI 缝 `mapClient` 注入 mapper **返回值**（transport 替身），且注入的 `freshness.reason_code` 取值**必须与 `packages/brain/src/map/radius.js` 权威枚举字面一致**（见分类表）——这是该数据边的合同锚，非任意造数。
  - 豁免登记：`mapClient` 注入是 diff-gate.js 既有依赖注入缝（源码签名 `mapClient?: Function // 可注入 mock（供测试使用）`），且真实 mapper（radius.js）运行需 Postgres（本 attempt `postgres:false`），其 HTTP 传输/契约校验由 `map-client.test.js` 独立覆盖。本单改动**不触碰** mapper 计算逻辑，只改 diff-gate 对其输出的分类——故被改的边（分类逻辑）真实执行，未被 mock。
- **diff-gate ↔ Postgres（db 写路径）**：本单**不改** db 写路径（drift→gap_events/block 在步骤 5，非本单范围）；被测终态分支在步骤 3a 早于任何 `db.query` 返回，故 `db=undefined` 不掩盖任何被改的 DB 边。

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> **多代码块拼接语义**: 本段仅单一 bash 块。
> **vitest 工作目录死规则（9.25.0）**: `packages/brain/src/**` 的 vitest 一律 `(cd packages/brain && npx vitest run --no-cache ./src/...)` 子 shell 执行；sprints/** 合同测试可从仓库根 `npx vitest run`。
> **无 Postgres**: 被测分支在 db.query 之前返回，脚本全程不连 DB。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

echo "== 1. sprint 回归测试（TDD Red→Green，导入真实 diff-gate.js，从仓库根跑 sprints/**）=="
npx vitest run --no-cache sprints/08201318-kernel-b7aecbef/tests/diff-gate-mapper-stale-reason-code.test.js 2>&1 | tee /tmp/e2e-sprint.log
grep -qE "Test Files[[:space:]]+1 passed" /tmp/e2e-sprint.log || { echo "FAIL: sprint 回归测试未全绿"; exit 1; }

echo "== 2. brain 既有 diff-gate 套件不回退（子 shell 进 packages/brain）=="
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ) 2>&1 | tee /tmp/e2e-brain.log
grep -qE "Test Files[[:space:]]+1 passed" /tmp/e2e-brain.log || { echo "FAIL: 既有 diff-gate 套件回退"; exit 1; }

echo "== 3. 终态确定性结论 fail-closed（真实函数直跑，node 内断言 exit code 驱动）=="
( cd packages/brain && node --input-type=module -e 'import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js"; const term = await evaluateDiffGate({ db: undefined, taskId: "e2e-term", headRevision: "deadbeef", changedFiles: ["a.js"], mapClient: async () => ({ freshness: { status: "unknown", reason_code: "capability_not_in_active_projection" }, fact_revisions: {}, affected_nodes: [], required_assertions: [] }) }); if (!(term.gate === "impact_unknown" && term.retryable === false && term.reason_code === "capability_not_in_active_projection" && term.reason !== "mapper_stale")) { console.error("FAIL terminal", JSON.stringify(term)); process.exit(1); } const trans = await evaluateDiffGate({ db: undefined, taskId: "e2e-trans", headRevision: "deadbeef", changedFiles: ["a.js"], mapClient: async () => ({ freshness: { status: "stale", reason_code: "fact_snapshot_stale" }, fact_revisions: {}, affected_nodes: [], required_assertions: [] }) }); if (!(trans.retryable === true && trans.reason_code === "fact_snapshot_stale")) { console.error("FAIL transient", JSON.stringify(trans)); process.exit(1); } const miss = await evaluateDiffGate({ db: undefined, taskId: "e2e-miss", headRevision: "deadbeef", changedFiles: ["a.js"], mapClient: async () => ({ freshness: { status: "unknown" }, fact_revisions: {}, affected_nodes: [], required_assertions: [] }) }); if (!(miss.retryable === false && (miss.reason_code ?? null) === null)) { console.error("FAIL missing", JSON.stringify(miss)); process.exit(1); } console.log("OK: 终态 fail-closed + 瞬态保留 + 缺失兜底 三态齐");' )

echo "✅ Golden Path 验证通过：确定性 Map 结论透传 reason_code + fail-closed 非重试，无空转"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapClient 返回 `freshness: null` 或 `freshness: {}`（无 status）→ 断言仍走 `!mapperResult?.freshness || status!=='fresh'` 分支，`reason_code` 应为 null 且 `retryable=false`（不得抛异常、不得假绿 pass）。
- 未知新增 reason_code: 注入一个不在分类表内的字符串（如 `some_future_code`）→ 必须落入终态 fail-closed（`retryable=false`），验证白名单默认非重试语义。
- 边界值: `freshness.status='fresh'` 但仍带 `reason_code` 非 null → 必须走既有 fresh 路径（进步骤 3b/4 对账），不被步骤 3a 拦截（防误伤 fresh）。
- 大小写/类型: `reason_code` 为数字/对象等非字符串 → 归入终态兜底，不崩。
发现分级: P0/P1（终态被判 retryable=true 空转复发 / fresh 被误拦 / 抛未捕获异常）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## GAN 对抗焦点自证

- 每条验证命令均为 node/vitest 真执行，exit code 驱动，无 `echo ok`/`|| true` 吞错。
- 终态断言含 `reason !== "mapper_stale"` 反向检查，锁死空转根因（确定性结论不再输出裸常量）。
- 瞬态断言独立保留 `retryable=true`，防「一刀切改成全 false」的过度修复回退既有行为。

## Contract Gate 合规备注

- contract-gate: present（cecelia repo，代码层 Contract Gate 生效）。
- gp-anchor: skipped (product-map.json not found)。
- 断言写法：node 真执行 + exit code / vitest `Test Files 1 passed` 内容断言，均为 gate 认可的强 oracle；无裸 curl、无 `|| true` 吞错、无无时间窗计数（本单无 DB 计数断言）。
- late-bound identity: 本合同不含任何 attempt_id/capability_snapshot_id UUID 字面值；被测为纯函数，无 HARNESS_* 注入需求。
