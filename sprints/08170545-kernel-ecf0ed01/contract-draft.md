# Sprint Contract Draft (Round 1)

Diff Impact Gate 把确定性 Map 结论折叠成 `mapper_stale` 无限重试 —— 透传 reason_code 并 fail-closed 出口。

- **journey_type**: autonomous
- **target_environment**: local_api
- **锚定父路声明**: 独立小路（无父路）—— 本 sprint 修 kernel 内部决策闸（diff-gate/harness-gates/loop/derive），不覆盖任何产品 Golden Path 步骤。
- **contract-gate**: `packages/brain/src/lib/contract-gate.js` 存在（cecelia worktree）→ 代码层 Contract Gate 生效，断言按「Contract Gate 合规惯用法速查表」书写。

---

## Response Schema（推导来源: PRD 字面 + 现有代码 shape）

本任务**无 HTTP 响应端点**（纯 kernel 内部决策逻辑）。契约对象是三个内部函数的返回 shape：

### `evaluateDiffGate(...)` 返回（`packages/brain/src/impact-contract/diff-gate.js`）
mapper `freshness.status !== 'fresh'` 时按 `freshness.reason_code` 三分类：

```json
// (b) 确定性结论
{"gate":"blocked","reason":"<reason_code>","retryable":false,"detail":{"unclaimed_files":["DoD.md"],"capability_ids":["G1"]}}
// (a) 真新鲜度问题（回归保护）
{"gate":"impact_unknown","reason":"mapper_stale","retryable":true}
// (c) 未知 reason_code（fail-closed）
{"gate":"impact_unknown","reason":"mapper_contract_invalid","retryable":false}
```

- `gate` (string, 必填): `blocked`（确定性）| `impact_unknown`（新鲜度/未知）— 来源: PRD 修法 A
- `reason` (string, 必填): (b) 类为原 `reason_code` 字面；(a) 类为 `mapper_stale`；(c) 类为 `mapper_contract_invalid` — 来源: PRD 字面
- `retryable` (boolean, 必填): (a) `true`；(b)/(c) `false` — 来源: PRD 字面
- `detail` (object, 确定性 blocked 时必填): `{unclaimed_files:[], capability_ids:[]}` — 来源: PRD 修法 A
- **禁用字段名**: `stale`（不得把确定性结论仍标 `mapper_stale`）；`retry`（字段名固定 `retryable`）

### `gateReceipt(...)` 透传（`packages/brain/src/impact-contract/harness-gates.js` beforeEvaluate）
```json
{"stage":"diff","gate":"blocked","reason":"impact_anchor_missing","retryable":false,"detail":{"unclaimed_files":["DoD.md"]},"unclaimed_files":["DoD.md"]}
```
- 必须透传 `reason` / `retryable` / `detail`（现状只透传 reason/retryable，丢 detail）—— 来源: PRD 修法 B
- 并把 `unclaimed_files` / `capability_ids` 同时上浮到 receipt 顶层（供 loop 决策日志 `detail.impact_gate.unclaimed_files` 直读）—— 来源: PRD 验收「detail.impact_gate.unclaimed_files 非空」

### derive 路由（`packages/brain/src/orchestrator/derive.js` attemptCallbackRoute）
loop 把 impact 确定性 deny 记为 `verdict:attempt_callback`，detail = `{role, status:'blocked', failure_class:'impact_contract_invalid', reason:<reason_code>, unclaimed_files:[...]}`；derive 按 `detail.reason` 分流：
```
impact_anchor_missing               → {phase:'generate', action:'spawn:generator-fix'}（一次；同 run 再撞→ wait:human_review）
capability_assertion_coverage_missing → {phase:'review',   action:'wait:human_review'}
```

---

## 已知约束

### 来自回归测试（Step 1.2）
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` → `FR-4 Diff Impact Gate`：`实际影响 ⊆ 声明影响放行(pass)`、`新增影响触发 drift`、`Mapper 异常 fail-closed`（本 sprint 不得回退这些既有裁决）
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js` → `Harness Impact Gate 生产接线适配器`：`未纳入治理的存量任务不启用门禁`、`required 无 active 合同 fail-closed`
- `packages/brain/src/orchestrator/__tests__/derive-generator-infrastructure-retry.test.js` → `Generator 基础设施失败重试保持原派发动作`（INV「重试身份」不得破坏）

### 来自累积 FR（context-manifest）
- context-manifest: unavailable（本 line journey e6f803f2 现有 ability 均为 planned，无累积 done/working；`## 累积 FR` PRD 段亦为空）

### 来自 Unified Map must_run_assertions（Step 1.0）
- `[MAP_NOT_CONFIGURED]`：task.payload.map_repo=null（map_scope=["F1"] 但缺 repo）→ 未查询 radius，无 must_run_assertions 注入。不回退领域硬编码。

---

## 禁 mock 边清单

本单改动涉及**状态机（derive 路由）+ 跨模块数据传递（mapper→diff-gate→harness-gates→loop）+ DB 写路径（orchestrator_decision_log）**，故：

- **diff-gate.js ↔ mapper 输出 shape**：本单改 diff-gate 对 `freshness.reason_code` 的消费，冻结测试必须用**真实 radius 响应形态**（`tests/fixtures/d1360a48-radius-recording.json` 录制件，字段与 `radius.js:398-412` 返回逐字段一致）喂进真实 `evaluateDiffGate`，**不得** hand-mock diff-gate 内部；mapClient 是 diff-gate 既有注入 seam（被测函数的*输入*），非被改的边。
- **harness-gates.js ↔ diff-gate 结果**：beforeEvaluate 冻结测试跑**真实 `createHarnessImpactGates`**，仅注入 diffGate 结果（diff-gate 自身 shape 由上一条真实覆盖），断言 gateReceipt 对 reason/retryable/detail 的透传。
- **代码 ↔ orchestrator_decision_log 表**：Final E2E 用真 Postgres（scratch $DB_URL）真跑 `appendHop` 写入并 psql 回读，禁止 stub decision-log 写入。
- **derive.js 状态机**：derive 冻结测试用真实 `derive()` + 真实 `decisionLog` 行，不 mock attemptCallbackRoute。

（不 mock 上述任一被改边；仅允许 mock 的：**未改的上游 mapper**——以录制件供其输出；**数据访问 getActiveContract**——见「未覆盖真实链路清单」。）

---

## 真实调用方请求 shape

N/A —— 本单无外部设备/agent 调服务端。调用方是 kernel 内部 loop（`spawn:evaluator` 前置闸），调用形态由 `loop.js:1421-1455` 固定，非外部 HTTP 调用方。

---

## 未覆盖真实链路清单

| 被 mock/录制顶替的点 | 为什么 | 真验证补位计划 |
|---|---|---|
| mapper radius 输出（`queryImpactRadius`）以 `d1360a48-radius-recording.json` 录制件供给 | `radius.js` **本单不改**（结论本身正确，PRD 范围限定明确排除）；在 scratch 空库上重建一个「快照新鲜 + 恰好一个无主文件」的完整 Map projection 属另一 sprint 的种子工程 | Generator 实现阶段如 scratch 已有真实 map scan，可用真实 `GET /api/brain/map/radius` 重录该 fixture 覆盖；radius 自身正确性由其既有单测保证 |
| Final E2E 的 `getActiveContract` 注入桩返回固定 active 合同 | 避免在 E2E 内种全套 `impact_contracts` 行；getActiveContract 是数据访问，非本单改的分类/路由逻辑 | 被改的 diff-gate 分类 + harness-gates 透传 + decision-log 写入三条边在 E2E 全真跑 |

harness-controller 会把本清单原样呈现进 PR 描述与最终报告。

---

## Golden Path

[kernel 调 Diff Impact Gate（候选已产，含 Map 无主文件）] → [diff-gate 按 reason_code 三分类] → [harness-gates 回执透传 reason/retryable/detail] → [loop 记 deny:impact:<reason> 进 orchestrator_decision_log] → [derive 按 reason 走 generator-fix 或 human_review，不再无限重试]

### Step 1: mapper 在快照新鲜下写入确定性 reason_code，diff-gate 三分类
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 步 + 修法 A

**可观测行为**: mapper 返回 `{freshness:{status:'unknown', reason_code:'impact_anchor_missing'}, unclaimed_files:['DoD.md']}` 时，`evaluateDiffGate` 返回 `gate='blocked'`、`reason='impact_anchor_missing'`、`retryable=false`、`detail.unclaimed_files=['DoD.md']`；`capability_assertion_coverage_missing` 同类；`fact_snapshot_stale`（真新鲜度）仍 `impact_unknown/mapper_stale/retryable=true`；未知 reason_code fail-closed `mapper_contract_invalid/retryable=false`。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run --root packages/brain src/impact-contract/__tests__/diff-gate-reason-code.test.js
# 期望：3 分类 + 回归 + fail-closed 全绿（Generator 复制的常驻回归测试）
```
**硬阈值**: vitest exit 0；`gate==='blocked'`/`retryable===false`/`detail.unclaimed_files` 三断言全过。

---

### Step 2: harness-gates beforeEvaluate 回执透传 reason/retryable/detail
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步 + 修法 B

**可观测行为**: 确定性 blocked 结果经 `gateReceipt` 后，receipt 含 `reason='impact_anchor_missing'`、`retryable=false`、`detail.unclaimed_files=['DoD.md']`，且 `unclaimed_files` 上浮 receipt 顶层。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run --root packages/brain src/impact-contract/__tests__/harness-gates-receipt.test.js
# 期望：receipt.detail 非空且 unclaimed_files=['DoD.md']
```
**硬阈值**: vitest exit 0。

---

### Step 3: derive 按 reason 走确定性出口，不再退避重试
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步（loop.js/derive）+ 边界情况

**可观测行为**: `impact_contract_invalid` + `reason=impact_anchor_missing` → 下一动作 `spawn:generator-fix`（一次；同 run 再撞 → `wait:human_review`）；`reason=capability_assertion_coverage_missing` → `wait:human_review`。不再进 `infrastructure_blocked` 退避。

**验证命令**:
```bash
node node_modules/vitest/vitest.mjs run --root packages/brain src/orchestrator/__tests__/derive-impact-route.test.js
# 期望：impact_anchor_missing→generator-fix；coverage_missing→human_review；已修一次→human_review
```
**硬阈值**: vitest exit 0。

---

### Step 4: 出口 —— 确定性 verdict 落 orchestrator_decision_log
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步 + 验收（可观测结果）

**可观测行为**: 触发一次 evaluator 前置闸（候选含 Map 无主文件）后，`orchestrator_decision_log` 新增行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.unclaimed_files` 非空。

**验证命令**: 见 `## E2E 验收`（psql 时间窗断言）。
**硬阈值**: 5 分钟内新增行；`retryable=false`；`unclaimed_files` 数组长度 ≥ 1。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | diff-gate 按 reason_code 三分类，确定性结论 retryable:false + 透传 detail，derive 路由 generator-fix/human_review | 见 Response Schema |
| **NFR（做得多好）** | 消除「每 90s 重试到 deadline」的确定性误重试；分类为 O(1) 常量集合查找 | PRD 未指定量化时延 NFR；目标是**去掉**错误重试行为 |
| **Invariant（永不违反）** | ① 真新鲜度问题（fact_snapshot_stale 等）仍 retryable:true（回归保护）② 未知 reason_code 一律 fail-closed，禁止静默当新鲜度重试 ③ radius.js 结论不放宽 | 见 INV-1/2/3（contract-dod） |
| **判定点（怎么知道）** | 见判定点登记表 | 见下方登记表 |
| **保质期（何时过期）** | `DETERMINISTIC_IMPACT_ERROR_CODES` 集合随 radius.js reason_code 枚举演进；新增 reason_code 未登记时由 (c) 类 fail-closed 兜住，不会静默失效 | 无固定过期；由 (c) 类兜底 |
| **死亡告警（停了谁知道）** | 若分类回退（确定性结论又被标 mapper_stale），run 会重新空转到 deadline —— 由 deadline fence + `impact_gate_deterministic` 终态可观测；回归测试常驻 CI 拦截回退 | CI 回归 + deadline 可观测 |
| **失败语义（挂了怎么办）** | 见失败语义声明 | 见下表 |
| **效果确认（已发≠已生效）** | 落库即生效：`orchestrator_decision_log` 新行 `gate_verdict` + `detail.impact_gate` 为回执，psql 时间窗查得即确认 | E2E psql 断言 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳 | 静默丢消息 |
| ⚠️ 某 reason_code 属「可重试新鲜度问题」还是「确定性结论」 | A. 硬编码集合区分 (a)/(b)/(c)；B. 看 retryable 字段 | A. 按 reason_code 归属 `DETERMINISTIC_IMPACT_ERROR_CODES` / 新鲜度集合 / 兜底 fail-closed | radius.js 的 freshness/确定性两类 reason_code 是稳定枚举，集合归属最直接；未知一律 fail-closed 防误重试 | 误判 (b)→(a)：确定性结论被无限重试到 deadline（本单要修的原病）；误判 (a)→(b)：真新鲜度问题被过早判死，本可重试的 run 被误 fail |
| impact_anchor_missing 候选是否可由 generator-fix 自愈 | A. 直接 human_review；B. generator-fix 一次再兜底 human_review | B | 无主文件常是候选新建的可删/挪文件，fix 一次成本低；防死循环靠「一次」上限 | 误判可自愈：多空转一个 generator-fix 跳；已由「一次后 human_review」兜底 |

> ⚠️ 判定点属「静默丢数据/run 误终态」级；本单实现即固化该判定，PrepPRD 已隐含拍板（PRD 三分类边界即答案），无需再 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| mapper 不可达（queryImpactRadius throw） | 保持现状 `impact_unknown/mapper_unavailable/retryable:true` | 是 | 重试（真基础设施问题，不在本单三分类范围） |
| 确定性结论 impact_anchor_missing/capability_assertion_coverage_missing | blocked/retryable:false，走 derive 确定性出口 | 否（重试不改变结论） | generator-fix 一次 / human_review |
| 未知/新增 reason_code | fail-closed `mapper_contract_invalid/retryable:false` | 否 | 不重试；进确定性出口交人审，禁止静默当新鲜度重试 |
| generator-fix 修一次仍 impact_anchor_missing | 兜底 wait:human_review | 否 | 人审，避免 fix↔gate 死循环 |

### 输入对抗面

N/A —— 本单无对外暴露 agent 输入；消费的是 kernel 内部 mapper 结论对象，非外部不可信输入。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> autonomous / local_api：真 Postgres（scratch `$DB_URL`）+ 真 kernel 代码（diff-gate 分类 + harness-gates 回执 + decision-log 写入全真跑）。唯一录制件是**未改的上游 mapper 输出**（见「未覆盖真实链路清单」）。evaluator 模式 B 独立跑本段。
> 全部逻辑落在committed脚本 `sprints/08170545-kernel-ecf0ed01/e2e-verify.sh`（含空库 migration bootstrap → 真 gate 分类+回执 → 真 appendHop 写入 → psql 时间窗三断言），避免 markdown 内长脚本漂移。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
bash "$(git rev-parse --show-toplevel)/sprints/08170545-kernel-ecf0ed01/e2e-verify.sh"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapper 返回 `freshness.status='unknown'` 但 `reason_code` 缺失（null/空串）→ 必须走 (c) 类 fail-closed `mapper_contract_invalid/retryable:false`，禁止 crash 或当新鲜度重试
- 重复提交: 同一 run 连续两跳都命中 impact_anchor_missing → 第二跳必须是 human_review（不得再 generator-fix），验证「一次」上限幂等
- 中途中断: derive 收到 `impact_contract_invalid` 但 detail.reason 为未登记新值 → 应保守 human_review，不得静默退避重试
- 边界值: `unclaimed_files=[]` 但 reason_code=impact_anchor_missing（矛盾输入）→ 分类仍 blocked，detail.unclaimed_files 为空数组不 crash
发现分级: P0/P1（确定性结论又被无限重试 / run 误终态丢候选）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 三分类 | `tests/diff-gate-reason-code.contract.test.js` | `impact_anchor_missing → blocked`、`capability_assertion_coverage_missing → blocked`、`fact_snapshot_stale`、`未知 reason_code`、`run d1360a48` | → 4 failed / 1 passed（回归 guard） |
| harness-gates 回执透传 | `tests/harness-gates-receipt.contract.test.js` | `gateReceipt 含 reason/retryable/detail` | → 1 failed |
| derive impact 路由 | `tests/derive-impact-route.contract.test.js` | `impact_anchor_missing → spawn:generator-fix`、`capability_assertion_coverage_missing → wait:human_review`、`已 generator-fix 过一次仍 blocked → 兜底 wait:human_review` | → 1 failed / 2 passed（guard） |

> 命名死规则：上表「BEHAVIOR 覆盖」名均为对应 `it()` 名的字面子串。
> 冻结测试落位（r2 硬要求）：本三份测试 + fixture 放 `sprints/08170545-kernel-ecf0ed01/tests/`；Generator 实现阶段复制为常驻回归到 `packages/brain/src/impact-contract/__tests__/`（diff-gate/harness-gates-receipt）与 `packages/brain/src/orchestrator/__tests__/`（derive-impact-route）。
