# Sprint Contract Draft (Round 1)

**锚定父路声明**: 独立小路（无父路）——journey e6f803f2 golden-paths 查询返回空，本 line 暂无已 done/working ability，本 sprint 是 kernel/orchestrator 内部可靠性修复的独立小路。

gp-anchor: skipped (product-map.json not found)
contract-gate: present (cecelia worktree) — 断言按 Contract Gate 惯用法书写

## Response Schema（推导来源: PRD 字面 + 现有代码返回体，无新增 HTTP 端点）

本 sprint 无新增/改动 HTTP 端点（纯 Brain kernel/orchestrator 内部逻辑）。可观测契约有两个：
（1）`evaluateDiffGate(...)` 返回对象；（2）`orchestrator_decision_log.detail.impact_gate` 落库结构。

### (1) evaluateDiffGate 返回对象（diff-gate.js）
确定性阻断分类新增/变更字段：
```json
{"gate":"blocked","reason":"impact_anchor_missing","retryable":false,"detail":{"unclaimed_files":["DoD.md"],"capability_ids":[]}}
```
- `gate` (string, 必填): `'blocked'`（确定性结论）| `'impact_unknown'`（新鲜度/未知）| `'pass'|'extend'|'drift'`（既有裁决，不改）。来源——PRD Step 3。
- `reason` (string, 必填): 确定性 → 原 `reason_code` 字面（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）；真新鲜度 → `'mapper_stale'`；未知 → `'mapper_contract_invalid'`。来源——PRD Step 3(a)(b)(c) 字面。
- `retryable` (bool, 必填): 确定性/未知 fail-closed → `false`；真新鲜度 → `true`。来源——PRD Step 3。
- `detail` (object, 确定性阻断时必填): `{unclaimed_files: string[], capability_ids: string[]}`。来源——PRD Step 3(b)「detail 带 unclaimed_files 与缺覆盖 capability_ids」。

**禁用字段名**: `reason` 值禁用同义替换（如把 `impact_anchor_missing` 改写成 `anchor_missing`/`no_owner`）；`retryable` 禁用 `retry`/`can_retry` 别名；确定性 reason 禁复用为 `mapper_stale`（正是本单要修的折叠）。

### (2) orchestrator_decision_log 落库（loop.js append）
```json
{"gate_verdict":"deny:impact:impact_anchor_missing","detail":{"impact_gate":{"stage":"diff","gate":"blocked","reason":"impact_anchor_missing","retryable":false,"detail":{"unclaimed_files":["DoD.md"],"capability_ids":[]}}}}
```
- `gate_verdict` (string): `deny:impact:<reason>`（loop.js:1454 既有格式，reason 现在是确定性 reason 而非恒为 mapper_stale）。
- `detail.impact_gate.retryable` (bool): 确定性阻断 = `false`。
- `detail.impact_gate.detail.unclaimed_files` (string[]): impact_anchor_missing 时非空。

**Error（内部无 HTTP 4xx）**: N/A — 失败经 `failure_class` 分流，不返回 HTTP error body。

---

## Golden Path

[Generator 产出候选] → [Diff Impact Gate 按 reason_code 三分类] → [gateReceipt 透传 reason/retryable/detail] → [loop 对 retryable:false 走确定性出口] → [derive 按 reason 路由 generator-fix / human_review] → [orchestrator_decision_log 落确定性 verdict，kernel 不再无限重试]

### Step 1: diff-gate.js 按 reason_code 三分类
**来源**: `[FROM_PRD]` — PRD「Golden Path」Step 3 (a)(b)(c) 三分类逐字定义。

**可观测行为**: mapper 返回 `freshness.status!=='fresh'` 时，diff-gate 不再一律 `mapper_stale`；按 `reason_code` 分：(a) 真新鲜度→`impact_unknown/mapper_stale/retryable:true`；(b) 确定性→`blocked/<reason_code>/retryable:false` + detail；(c) 未知→`impact_unknown/mapper_contract_invalid/retryable:false`。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/diff-gate-reason-classify.test.js 2>&1 | grep -qE "Tests +[0-9]+ passed" && ! (npx vitest run sprints/08161913-kernel-8f826ee6/tests/diff-gate-reason-classify.test.js 2>&1 | grep -qE "[0-9]+ failed") || { echo FAIL; exit 1; }
```
**硬阈值**: 该测试全部 7 例 pass、0 failed。

---

### Step 2: harness-gates.beforeEvaluate gateReceipt 透传 detail
**来源**: `[FROM_PRD]` — PRD Step 4「gateReceipt 透传 reason/retryable/detail（含 unclaimed_files / 缺覆盖 capability_ids）」。

**可观测行为**: beforeEvaluate 返回的 receipt 携带 `reason`、`retryable`、以及原来被丢弃的 `detail`（unclaimed_files / capability_ids）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/harness-gates-receipt-passthrough.test.js 2>&1 | grep -qE "2 passed" || { echo FAIL; exit 1; }
```
**硬阈值**: receipt.detail.unclaimed_files / receipt.detail.capability_ids 均非 undefined。

---

### Step 3: loop.js 确定性出口（DETERMINISTIC set + failure_class）
**来源**: `[FROM_PRD]` — PRD Step 5「retryable:false 不再按 infrastructure_blocked 退避；DETERMINISTIC_IMPACT_ERROR_CODES 补入确定性 reason，failure_class=impact_contract_invalid，交 derive」。

**可观测行为**: `DETERMINISTIC_IMPACT_ERROR_CODES`(loop.js:84) 补入 5 个确定性 reason（impact_anchor_missing / capability_assertion_coverage_missing / capability_not_in_active_projection / unsafe_assertion_ref / assertion_identity_ambiguous）；retryable:false 的 impact 结论 failure_class=`impact_contract_invalid`，不再走 `sleep(POLL_INTERVAL_MS); continue` 退避重试。

**验证命令**:
```bash
cd /workspace && node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8'); const set=c.slice(c.indexOf('DETERMINISTIC_IMPACT_ERROR_CODES'), c.indexOf('DETERMINISTIC_IMPACT_ERROR_CODES')+600); for(const r of ['impact_anchor_missing','capability_assertion_coverage_missing','capability_not_in_active_projection','unsafe_assertion_ref','assertion_identity_ambiguous']){ if(!set.includes(r)){console.error('missing',r);process.exit(1);} } console.log('OK');"
```
**硬阈值**: 5 个确定性 reason 全部出现在 DETERMINISTIC_IMPACT_ERROR_CODES 集合定义内。

---

### Step 4: derive.js 按 reason 路由
**来源**: `[FROM_PRD]` — PRD Step 6「impact_anchor_missing→generator-fix 一次（携 unclaimed_files），仍失败→human_review；capability_assertion_coverage_missing→直接 human_review」。

**可观测行为**: derive 见 decisionLog 最新 impact 阻断（retryable:false）→ 按 reason 路由，不再回落 spawn:evaluator 无限重试。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/derive-impact-route.test.js 2>&1 | grep -qE "3 passed" || { echo FAIL; exit 1; }
```
**硬阈值**: 3 例全 pass（首次→generator-fix 带 unclaimed_files；二次→human_review；capability_assertion_coverage_missing→human_review）。

---

### Step 5: run d1360a48 回归夹具复现
**来源**: `[FROM_PRD]` — PRD E2E 验收点 4「用 run d1360a48 真实 changed_files（含 DoD.md）+ 真实 radius 录制件复现旧 mapper_stale / 新 blocked:impact_anchor_missing」。

**可观测行为**: 录制的真实 radius 输出喂 diff-gate → 新代码判 blocked:impact_anchor_missing/retryable:false，永久回归护栏防折叠回 mapper_stale。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08161913-kernel-8f826ee6/tests/regression-d1360a48.test.js 2>&1 | grep -qE "1 passed" || { echo FAIL; exit 1; }
```
**硬阈值**: 夹具例 pass，result.reason='impact_anchor_missing' 且 !='mapper_stale'。

---

### Step 6: orchestrator_decision_log 可观测出口（Final E2E — 数据写入类，scratch 库）
**来源**: `[FROM_PRD]` — PRD 可观测出口 + E2E 验收点 5。

**可观测行为**: 对 scratch Brain 触发一次 evaluator 前置闸（impact_anchor_missing 场景）→ `orchestrator_decision_log` 新增行 `gate_verdict='deny:impact:impact_anchor_missing'` 且 `detail.impact_gate.retryable=false` 且 `detail.impact_gate.detail.unclaimed_files` 非空；kernel 不再 90s 无限重试。

**验证命令**: 见 `## E2E 验收` 段完整脚本（psql 带 5 分钟时间窗防造假）。
**硬阈值**: 新增行 count ≥ 1（`created_at > NOW() - interval '5 minutes'`），retryable=false，unclaimed_files 非空。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → FR-4 Diff Impact Gate：实际影响 ⊆ 声明影响放行、新增影响触发 drift、Mapper 异常 fail-closed（本单不得回退这些既有裁决路径，只在 freshness!=='fresh' 分支细分）。
- [packages/brain/src/impact-contract/__tests__/harness-gates.test.js] → beforeEvaluate/beforeGenerate/beforeMerge 各 gate 组装（本单只在 gateReceipt 增补 detail 透传，不改既有字段语义）。
- [packages/brain/src/__tests__/integration/impact-contract-loop.integration.test.js] → Impact Contract → Gap → 修复 → 恢复真实 PG 闭环（本单不改 gap/drift 路径）。

### 累积 FR（context-manifest）
- （本 line 暂无历史）— journey e6f803f2 golden-paths 查询返回空，无累积 FR。

### Unified Map must_run_assertions
- [MAP_NOT_CONFIGURED] — task.payload 无 map_scope/map_repo，radius 半径断言未注入；本单不依赖 Map 半径推导（改的是 Map 消费方分类逻辑本身）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | diff-gate 把 radius 确定性 reason_code 透传，consumer 侧 fail-closed 出口 | diff-gate 三分类；gateReceipt 透传 detail；loop DETERMINISTIC set；derive 按 reason 路由 |
| **NFR（做得多好）** | 可靠性/可观测 | 未知 reason_code fail-closed；确定性拦截写 orchestrator_decision_log 带 reason/retryable/unclaimed_files/capability_ids |
| **Invariant（永不违反）** | 未知 reason_code 禁默认放行/默认可重试；radius 与 map-client 不改 | fail-closed；只改消费方（diff-gate/harness-gates/loop/derive） |
| **判定点（怎么知道）** | reason_code 属 (a) 新鲜度 还是 (b) 确定性 | 见判定点登记表 |
| **保质期（何时过期）** | reason_code 枚举随 radius 演进 | (a)(b) 枚举硬编码在 diff-gate；新增 reason_code 落 (c) fail-closed，不静默过期 |
| **死亡告警（停了谁知道）** | 确定性拦截若又变无限重试 | 回归夹具 regression-d1360a48 永久护栏 + Final E2E 校 retryable=false；run 不再空转到 deadline |
| **失败语义（挂了怎么办）** | mapper 不可达 / 未知 reason_code | mapper 不可达→mapper_unavailable/retryable:true（既有，不改）；未知 reason_code→mapper_contract_invalid/retryable:false（fail-closed 拦截） |
| **效果确认（已发≠已生效）** | 拦截是否真写日志 | Final E2E psql 查 orchestrator_decision_log 新增行（带时间窗）确认落库 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ reason_code 属真新鲜度还是确定性结论 | A. 按 freshness.status（stale=新鲜度,unknown=确定性）; B. 按 reason_code 白名单枚举分组 | B. reason_code 白名单枚举分组（(a)集/(b)集，其余落(c) fail-closed） | radius 同时用 status:'unknown' 表达确定性（radius.js:390-396），单看 status 分不清；reason_code 才是权威语义 | 误判成新鲜度→无限重试到 deadline（本单要修的病）；误判成确定性→真新鲜度问题不再重试、run 假失败 |
| 未知/新增 reason_code 如何处置 | A. 默认放行; B. 默认可重试; C. fail-closed retryable:false | C. fail-closed retryable:false（mapper_contract_invalid） | 铁律[fail-closed]：未知不得默认放行或默认可重试 | 默认放行→未验证候选进 evaluator；默认可重试→回到无限重试病根 |

（⚠️ 行：误判后果为「run 空转到 deadline / 假失败」，属主动请教级别。judgment-pending-user: reason_code 分组归属——已由 PRD Step 3 明确 (a)(b)(c) 枚举，无需再确认。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| mapper 不可达 | impact_unknown/mapper_unavailable/retryable:true（既有，不改） | 是 | 退避复探，run deadline 收敛 |
| 确定性 reason_code（impact_anchor_missing 等） | blocked/retryable:false | 否（重试不改变结论） | impact_anchor_missing→generator-fix 一次→human_review；capability_assertion_coverage_missing→human_review |
| 未知/新增 reason_code | impact_unknown/mapper_contract_invalid/retryable:false | 否 | fail-closed，交 derive/human_review，禁默认放行 |

### 输入对抗面

N/A — 本单是 kernel/orchestrator 内部逻辑，输入为 radius（内部可信 Map 服务）结果，不对外暴露 agent 可写入接口。

---

## 禁 mock 边清单

本单涉及「状态机（gate 裁决分类/derive 路由）」「跨模块数据传递（diff-gate→gateReceipt→loop→derive 接力 reason/retryable/detail）」「DB 写路径（orchestrator_decision_log）」，禁 mock 以下被改的边：

- **diff-gate.evaluateDiffGate 分类逻辑 ↔ mapper reason_code 语义**（本单改分类）：测试必须真跑 diff-gate 分类；只允许注入 mapClient 顶替**未改的**上游 radius，且回归夹具用 run d1360a48 **真实录制**的 radius 输出（非手捏）。禁 mock diff-gate 自身。
- **代码 ↔ orchestrator_decision_log DB 表（写路径）**（本单让 loop 写确定性 verdict）：Final E2E 必须真 Postgres 写入并 psql 读回校验，禁 mock DB / 禁只查 HTTP 200。
- **derive.derive() 纯函数状态机**（本单加 impact 路由分支）：真调 derive，禁 mock；observed/decisionLog 手工注入纯数据（decisionLog 是数据非模块本体，符合既有 derive 测试惯例）。
- （允许替身）harness-gates.beforeEvaluate 的单测经 `createHarnessImpactGates` 既定 DI seam 注入 diffGate/getActiveContract——这是工厂既定注入口，非 mock 被改模块本体；diff-gate↔harness-gates 的真 DB 边由 Final E2E 覆盖。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: mapper 返回 `freshness` 缺 `reason_code`（只有 status:'unknown' 无 reason_code）→ 必须 fail-closed 落 (c) mapper_contract_invalid/retryable:false，禁当成 (a) mapper_stale 放行重试。
- 重复提交: 同一候选连续两跳都命中 impact_anchor_missing → 第二跳后必须 human_review，禁再派 generator-fix（防新循环）。
- 中途中断: derive 收到确定性阻断但 decisionLog 无对应 gate_verdict 行（只有 detail.impact_gate）→ 路由判定应容错，仍能取 reason。
- 边界值: mapper 返回多个确定性 reason_code 同时命中 → 取首要 reason_code，detail 汇总全部证据（PRD 边界情况）。
- 边界值: unclaimed_files=[] 但 reason=impact_anchor_missing → 仍 blocked/retryable:false（不因空数组回退）。
发现分级: P0/P1（确定性结论又被折叠成无限重试 / fail-closed 失效默认放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 数据写入类 Final E2E：对 scratch Brain 触发一次 evaluator 前置闸（impact_anchor_missing 场景），psql 查 orchestrator_decision_log 新增行带确定性 verdict + retryable=false + unclaimed_files 非空。DB_URL 由 Fleet 注入（本 attempt scratch 库）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
# 单一事实来源：完整 Final E2E 脚本见 sprints/08161913-kernel-8f826ee6/e2e-verify.sh
# （1: 空 scratch 库跑真实 migration 机检 orchestrator_decision_log 表；2: 合同单测全绿；
#  3: 被改 diff-gate + 真实 appendHop 写 impact_anchor_missing 决策行；4: psql 带 5 分钟时间窗校验）
bash sprints/08161913-kernel-8f826ee6/e2e-verify.sh
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 三分类 | `tests/diff-gate-reason-classify.test.js` | impact_anchor_missing → gate=blocked、其余确定性 reason_code 全部 blocked、其余真新鲜度、未知/新增 reason_code | 7 例中 5 例 expected 'impact_unknown' to be 'blocked' / 'mapper_stale' to be 'mapper_contract_invalid' |
| gateReceipt 透传 | `tests/harness-gates-receipt-passthrough.test.js` | receipt.detail.capability_ids 透传、receipt 含 reason / retryable=false | expected undefined to deeply equal [...] |
| derive 路由 | `tests/derive-impact-route.test.js` | impact_anchor_missing 首次 → spawn:generator-fix、capability_assertion_coverage_missing → 直接 wait:human_review | expected 'spawn:evaluator' to be 'spawn:generator-fix' |
| 回归夹具 | `tests/regression-d1360a48.test.js` | 真实 changed_files（含 DoD.md）+ 真实 radius 录制件 → blocked:impact_anchor_missing | expected 'impact_unknown' to be 'blocked' |
