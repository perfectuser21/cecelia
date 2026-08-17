# Sprint Contract Draft (Round 1)

**sprint**: 08172017-kernel-37cf5c5f
**journey_type**: autonomous
**target_environment**: local_api
**base_sha (implementation_baseline, frozen)**: 7cbc3d19516f45211076c0e309d91b385ce7ef24

> gp-anchor: skipped (product-map.json not found) —— 本仓库（cecelia）根目录无 `product-map/generated/product-map.json`，Step 1.7 GP-Anchor 段整体跳过，不阻塞。
> contract-gate: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在 → 代码层 Contract Gate 生效，本合同断言按「Contract Gate 合规惯用法速查表」书写。
> [MAP_NOT_CONFIGURED]: task.payload.map_scope=['F1'] 但 map_repo 缺失（Step 1.0 radius 探测无法组合 scope/repo → not_configured），本轮无 must_run_assertions 注入；不回退领域硬编码，按 PRD + 代码实测起草。
> **合同测试落位（r2 死因修复）**: 本轮合同冻结测试全部落 `sprints/08172017-kernel-37cf5c5f/tests/`（kernel 采集冻结产物只认此路径；前一单 f9f943fc 因放 `packages/brain/src/**/__tests__/` → `force_approve_but_contract_artifacts_missing` 终态）。永久回归测试由 Generator 在实现阶段**复制**到 `packages/brain/src/**/__tests__/`（CLAUDE.md 硬规则 20：failing test 永久保留 CI）。

## 锚定父路声明

独立小路（无父路）—— PrepPRD `step_id: none`，journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 未锚定任何 Golden Path 步骤；本 sprint 是 kernel 内部调度决策的独立修复路径。

---

## 路径校正（PRD 文件路径 → 代码实测路径）

PRD「预期受影响文件」用了简写路径，实测真实路径如下（合同以实测为准）：

| PRD 简写 | 实测真实路径 |
|---|---|
| `diff-gate.js` | `packages/brain/src/impact-contract/diff-gate.js` |
| `harness-gates.js` | `packages/brain/src/impact-contract/harness-gates.js` |
| `loop.js`（含 derive） | `packages/brain/src/orchestrator/loop.js` + `packages/brain/src/orchestrator/derive.js` |
| `radius.js`（不改） | `packages/brain/src/map/radius.js` |

**实测关键事实（起草依据，已逐行核对当前 base 7cbc3d19 代码）**：

1. `diff-gate.js` 步骤 3a（当前 `evaluateDiffGate` 内，实测 line 201-207）：
   ```js
   if (!mapperResult?.freshness || mapperResult.freshness.status !== 'fresh') {
     return { gate: 'impact_unknown', reason: 'mapper_stale', retryable: true };
   }
   ```
   —— 把一切非 fresh（含 `status:'unknown'` 的确定性结论）统一折叠成 `mapper_stale/retryable:true`，**丢掉 `mapperResult.freshness.reason_code` 与 `mapperResult.unclaimed_files`**。这是无限重试根因。
2. `radius.js`（不改，仅作为 reason_code 来源事实）：`resolveImpactRadius` 返回
   `{ freshness:{ status, reason_code, checked_at, mapper_revision }, unclaimed_files:[...], affected_nodes:[...], required_assertions:[...], fact_revisions:{...} }`。
   - 真新鲜度类（`baseFreshness`：`status:'stale'` 且 reason_code ∈ `fact_snapshot_stale`/`projection_revision_missing`/`projection_revision_mismatch`）——radius.js:80-90。
   - 确定性类（`status:'unknown'` 且 reason_code ∈ `capability_not_in_active_projection`/`impact_anchor_missing`/`unsafe_assertion_ref`/`assertion_identity_ambiguous`/`capability_assertion_coverage_missing`）——radius.js:381-397。
3. `harness-gates.js` `gateReceipt(stage, result, extra)`（实测 line 26-36）当前只透传 `stage/gate/reason/retryable/contract_id/contract_hash` + extra，**不含 `detail`、不含 `unclaimed_files`**。
4. `loop.js`：
   - 实测 line 84-90：`DETERMINISTIC_IMPACT_ERROR_CODES` 集合当前为 `{impact_contract_schema_invalid, impact_assertion_authority_invalid, mapper_evidence_invalid, mapper_evidence_missing, task_not_found}`——**不含**本 sprint 的确定性 reason（impact_anchor_missing / capability_assertion_coverage_missing），需补入。
   - 实测 line 1454：`gateVerdict = deny:impact:${impactGateReceipt?.reason ?? 'unknown'}`。
   - 实测 line 1514：决策日志 `detail.impact_gate = impactGateReceipt`（受 gateReceipt 输出限制）。
   - 实测 line 1538-1544：`gateVerdict` deny 时 `failure_class = impactGateReceipt?.retryable === false ? 'impact_contract_invalid' : 'infrastructure_blocked'`（已按 retryable 分流，故 diff-gate 改 retryable 后此处天然改道）。
   - `failure_class === 'impact_contract_invalid'` 分支当前直接终止 run 出口，不经 derive 按 reason 路由——本 sprint 要把它改成「记 BLOCKED 结果 + 由 derive 按 reason 路由 spawn:generator-fix / wait:human_review」。
5. `constants.js`：动作字面量 `SPAWN_GENERATOR_FIX='spawn:generator-fix'`、`WAIT_HUMAN_REVIEW='wait:human_review'`（PRD 验收里写的 `spawn:generator_fix` 下划线是笔误，合同一律用代码真值 `spawn:generator-fix`）。

---

## Response Schema（推导来源: 读 diff-gate.js 结果结构 + PRD 边界；无 HTTP 端点）

本 sprint **无新增 HTTP 端点**（纯 Brain 内部调度决策逻辑）。Response Schema 指 `evaluateDiffGate(...)` 返回对象与决策日志 `detail.impact_gate` 的结构契约。字段名字面锁定，禁漂移。

### `evaluateDiffGate(...)` 返回（步骤 3a 分类分支，本 sprint 新增/修改）

**(a) 真新鲜度问题（可重试，回归保护，不改行为）**：
```json
{ "gate": "impact_unknown", "reason": "mapper_stale", "retryable": true }
```
命中条件：`mapperResult.freshness.status !== 'fresh'` 且 `reason_code` ∈ `{fact_snapshot_stale, projection_revision_missing, projection_revision_mismatch, manifest_projection_mismatch, graph_projection_revision_mismatch}`（或 `freshness` 缺失/无 reason_code 的既有兜底）。

**(b) 确定性结论（不可重试，fail-closed 出口）**：
```json
{ "gate": "blocked", "reason": "<原 reason_code>", "reason_code": "<原 reason_code>", "retryable": false,
  "detail": { "unclaimed_files": ["DoD.md"], "capability_ids": [] } }
```
命中条件：`freshness.status !== 'fresh'` 且 `reason_code` ∈ `{impact_anchor_missing, capability_assertion_coverage_missing, capability_not_in_active_projection, unsafe_assertion_ref, assertion_identity_ambiguous}`。
- `detail.unclaimed_files`：字面复制 `mapperResult.unclaimed_files ?? []`。
- `detail.capability_ids`：缺覆盖能力 id 列表（`capability_assertion_coverage_missing` 时非空，取自 `mapperResult.affected_nodes[].capability_id`；其余 reason 可为 `[]`）。

**(c) 其余未知 reason_code（fail-closed，禁静默放行）**：
```json
{ "gate": "impact_unknown", "reason": "mapper_contract_invalid", "retryable": false }
```
命中条件：`freshness.status !== 'fresh'` 且 `reason_code` 不在 (a)(b) 两个白名单内（含未来新增枚举）。

- **字段名字面锁定（禁漂移）**：`gate` / `reason` / `retryable` / `reason_code` / `detail.unclaimed_files` / `detail.capability_ids`。
- **禁用字段名**：`error`、`status`（顶层）、`stale`（作为 reason 值）、`mapper_stale`（不得用于确定性结论）。

### 决策日志 `detail.impact_gate`（gateReceipt 输出 + loop 写入）

```json
{ "stage": "diff", "gate": "blocked", "reason": "impact_anchor_missing", "retryable": false,
  "unclaimed_files": ["DoD.md"],
  "detail": { "unclaimed_files": ["DoD.md"], "capability_ids": [] },
  "contract_id": "<uuid|null>", "contract_hash": "<hash|null>" }
```
- gateReceipt 必须**同时**透传 `detail`（整个 `result.detail`）与顶层镜像 `unclaimed_files`（= `result.detail?.unclaimed_files ?? []`），使决策日志既能读 `detail.impact_gate.unclaimed_files` 又能读 `detail.impact_gate.detail.unclaimed_files`。
- 决策日志顶层 `gate_verdict`（列）= `deny:impact:impact_anchor_missing`（loop.js `deny:impact:${reason}` formula 不变）。

### 边界（对齐 PRD「边界情况」）

- 同一候选同时触发新鲜度 + 确定性 → **新鲜度优先**（(a) 先判，仍走 `mapper_stale/retryable:true`，避免真 stale 被误标 blocked）。实现顺序：先判 (a) 白名单，命中即返回；否则判 (b)；否则 (c)。
- `reason=impact_anchor_missing` 但 `unclaimed_files` 为空 → generator-fix 无法定位，derive 直接 `wait:human_review`（PRD 边界②）。
- mapper 全新 reason_code → 落 (c) fail-closed（PRD 边界③）。

---

## Golden Path

`[Generator 产出本地候选]` → `[beforeEvaluate Diff Impact Gate 三类分流]` → `[reason_code + detail 透传进决策日志]` → `[loop/derive 按 retryable/reason 走确定性出口，不再无限重试]`

---

### Step 1: Generator 候选进入 beforeEvaluate，mapper 返回确定性结论 `impact_anchor_missing`
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 步 + 根因①（`radius.js` 候选含 Map 无主文件 `DoD.md` → `impact_anchor_missing`, `unclaimed_files:['DoD.md']`）。

**可观测行为**: `evaluateDiffGate` 消费 mapper 的 `freshness.reason_code='impact_anchor_missing'` 与 `unclaimed_files=['DoD.md']`，返回 `gate='blocked'`, `reason='impact_anchor_missing'`, `retryable=false`, `detail.unclaimed_files=['DoD.md']`——**不再是 `mapper_stale/retryable:true`**。

**验证命令**:
```bash
npx vitest run sprints/08172017-kernel-37cf5c5f/tests/diff-gate-reason-code.test.js -t 'impact_anchor_missing'
# 期望：该用例 PASS（gate=blocked / reason=impact_anchor_missing / retryable=false / detail.unclaimed_files=['DoD.md']）
```
**硬阈值**: 用例 PASS（exit 0）。
**验证命令（硬阈值→可执行）**: 见 contract-dod.md B-01。

---

### Step 2: mapper 返回 `capability_assertion_coverage_missing`（能力无断言覆盖）
**来源**: `[FROM_PRD]` — PRD 根因①（f62c7e87 候选改 `apps/dashboard/*` → 能力 G1 零断言）。

**可观测行为**: `evaluateDiffGate` 返回 `gate='blocked'`, `reason='capability_assertion_coverage_missing'`, `retryable=false`, `detail.capability_ids` 非空。

**验证命令**:
```bash
npx vitest run sprints/08172017-kernel-37cf5c5f/tests/diff-gate-reason-code.test.js -t 'capability_assertion_coverage_missing'
# 期望：PASS
```
**硬阈值**: 用例 PASS（exit 0）。

---

### Step 3: 真新鲜度问题（`fact_snapshot_stale`）保持可重试（回归保护）
**来源**: `[FROM_PRD]` — PRD Golden Path 2(a) + 边界「新鲜度优先判可重试」。

**可观测行为**: `evaluateDiffGate` 返回 `gate='impact_unknown'`, `reason='mapper_stale'`, `retryable=true`（与旧代码同——真 stale 仍可重试，不被误判 blocked）。

**验证命令**:
```bash
npx vitest run sprints/08172017-kernel-37cf5c5f/tests/diff-gate-reason-code.test.js -t 'fact_snapshot_stale'
# 期望：PASS（回归保护，行为不变）
```
**硬阈值**: 用例 PASS（exit 0）。

---

### Step 4: 未知 reason_code → fail-closed `mapper_contract_invalid, retryable:false`
**来源**: `[FROM_PRD]` — PRD 边界③「mapper 返回全新 reason_code → (c) 分支 fail-closed，禁止静默放行」。
**说明**: `[AI_ADDED]`（分类骨架）——(c) 兜底分支确保未来新增枚举不被误当可重试或误放行；理由：防止 mapper 契约演进时静默漏判。

**可观测行为**: 未知 reason_code → `gate='impact_unknown'`, `reason='mapper_contract_invalid'`, `retryable=false`（不 blocked、不放行、不可重试）。

**验证命令**:
```bash
npx vitest run sprints/08172017-kernel-37cf5c5f/tests/diff-gate-reason-code.test.js -t 'mapper_contract_invalid'
# 期望：PASS
```
**硬阈值**: 用例 PASS（exit 0）。

---

### Step 5: harness-gates beforeEvaluate 的 gateReceipt 透传 reason/retryable/detail
**来源**: `[FROM_PRD]` — PRD 修法 B + Golden Path 第 3 步（gateReceipt 透传进 orchestrator_decision_log）。

**可观测行为**: `beforeEvaluate` 对确定性 blocked 结果产出的 receipt 含 `reason='impact_anchor_missing'`, `retryable=false`, `detail.unclaimed_files=['DoD.md']`, 顶层镜像 `unclaimed_files=['DoD.md']`。

**验证命令**:
```bash
npx vitest run sprints/08172017-kernel-37cf5c5f/tests/harness-gates-reason-code.test.js
# 期望：PASS（receipt.detail / receipt.unclaimed_files 存在且正确）
```
**硬阈值**: 用例 PASS（exit 0）。

---

### Step 6: loop/derive — retryable:false 走确定性出口，按 reason 路由
**来源**: `[FROM_PRD]` — PRD 修法 B + Golden Path 第 4 步（DETERMINISTIC_IMPACT_ERROR_CODES 补集，derive 按 reason 二选一）。

**可观测行为**:
- 决策日志 intent 行：`gate_verdict='deny:impact:impact_anchor_missing'`, `detail.impact_gate.retryable=false`, `detail.impact_gate.unclaimed_files` 非空。
- BLOCKED dispatch-result 行：`detail.failure_class='impact_contract_invalid'`。
- `reason=impact_anchor_missing` → **不再 failRun 空转**，下一动作 `spawn:generator-fix`（detail 携带 `unclaimed_files`）；同签名第二次仍失败 → `wait:human_review`。
- `reason=capability_assertion_coverage_missing` → `wait:human_review`。
- 回归保护：`reason=mapper_stale`（真 stale）仍走 `infrastructure_blocked` 退避重试（行为不变）。

**验证命令**:
```bash
npx vitest run sprints/08172017-kernel-37cf5c5f/tests/loop-impact-deterministic-route.test.js
# 期望：PASS（generator-fix / human_review 路由 + receipt 透传）
```
**硬阈值**: 用例 PASS（exit 0）。

---

### Step 7: 回归夹具 + Final E2E（真 Postgres 决策日志落行）
**来源**: `[FROM_PRD]` — PRD 验收「回归夹具」+「Final E2E（数据写入类，scratch 库）」。

**可观测行为**: scratch 库跑真实 `runLoop` 一跳（真 `createHarnessImpactGates` + 真 `evaluateDiffGate` + 真 `appendHop`，仅注入 out-of-scope 的 mapper 录制响应），`orchestrator_decision_log` 新增行 `gate_verdict='deny:impact:impact_anchor_missing'` 且 `detail->'impact_gate'->>'retryable'='false'` 且 `detail->'impact_gate'->'unclaimed_files'` 非空。旧代码在同夹具下产出 `deny:impact:mapper_stale`（回归对照）。

**验证命令**: 见下方 `## E2E 验收` 段。
**硬阈值**: 决策日志新增行满足上述三条件（带 5 分钟时间窗防历史数据冒充）。

---

## 已知约束（回归测试 + 累积 FR）

- [回归] `packages/brain/src/orchestrator/__tests__/loop.test.js` → 「Diff Gate 未放行时不创建 evaluator attempt，并把裁决写入 decision log」（`mapper_stale` 路径必须保留）+「Impact schema 确定性错误精确终止且不进入基础设施重试」（`impact_gate_deterministic` 出口对**抛错类**仍成立）。本 sprint 改的是**返回类**确定性结论的路由，不得破坏这两条既有用例语义。
- [回归] `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` → pass/extend/drift 三类既有裁决（`makeFreshMapperResult` fresh 路径）必须保持绿。
- [回归] `packages/brain/src/impact-contract/__tests__/harness-gates.test.js` → 既有 `legacy_exempt`/`declaration_missing` 等 receipt 语义不变。
- [回归] `packages/brain/src/impact-contract/__tests__/map-client.test.js` → `assertMapperContract` 不改（PRD 明示不动）。
- [累积FR] context-manifest: unavailable（journey `e6f803f2` 本 line 无历史；按 PRD「累积 FR：本 line 暂无历史」）。

## 历史约束三源 → INV 映射（EVA v2 固定段）

| 来源 | 铁律 | 本 sprint 映射 |
|---|---|---|
| area | [新鲜度重试身份] 确定性结论不得标可重试 | **INV-1**：`impact_anchor_missing`/`capability_assertion_coverage_missing` 等确定性 reason 必须 `retryable:false`（diff-gate B-01/B-02/B-04），真新鲜度 reason 仍 `retryable:true`（B-03） |
| area | [失败不静默] 失败路径显式 FAIL 带分类，禁 warning 降级放行 | **INV-2**：未知 reason_code 落 (c) fail-closed（B-04），确定性 blocked 记 `failure_class='impact_contract_invalid'`（B-06），禁静默放行 |
| area | [证据入决策日志] gate 结果写含 detail 的一手证据 | **INV-3**：gateReceipt 透传 reason/retryable/detail，决策日志 `detail.impact_gate` 含 unclaimed_files（B-05/B-06/B-09） |
| area | [status 枚举全仓核对] 新增 reason 枚举须全仓核对硬编码断言 | **INV-4**：本 sprint 不新增 reason 字面值（复用 radius.js 既有 reason_code + 既有 `mapper_stale`/`mapper_contract_invalid`/`impact_contract_invalid`）；仅新增消费分类，无新枚举字符串（自查 grep 见 DoD INV-4 条目） |
| area | [禁写死环境假设值] | N/A（本 sprint 无环境假设值；DB 连接用 `$DB_URL`，mapper 用注入录制件） |
| area | [真环境验证才算done] | **INV-5**：Final E2E 真 Postgres 落行验证（B-09），非纯单测收尾 |
| area | [测试默认多租户] | N/A（决策日志按 run_id 隔离，本 sprint 不触多租户身份） |
| area | [凭据安全]/[日志脱敏]/[端点鉴权]/[租户隔离] | N/A（无新凭据/新日志字段含敏感值/新端点/跨租户读写） |

## 真实调用方请求 shape

N/A —— 本 sprint 无「设备/agent 调服务端」链路，全部是 Brain 进程内模块间调用（diff-gate ← harness-gates ← loop）。真实调用方 = kernel orchestrator loop 自身，其调用 shape 即 `beforeEvaluate({task, pr, run})`，已在代码内固定，不涉及外部 header/body 双路径分叉。

## 未覆盖真实链路清单

- **mapper（`radius.js` / `/api/brain/map/radius`）用录制响应替身**｜为什么：radius.js 明确在 PRD 范围外（结论本身正确，错在消费方），且 radius.js 已有自己的 `radius.test.js` 真验；本 sprint 只改 mapper 结论的**消费方**（diff-gate/harness-gates/loop）｜真验证补位：diff-gate/harness-gates/loop 全部真实执行（未 mock 被改的边），仅注入一个与 radius.js `impact_anchor_missing` 输出**同形**的最小 mapper 响应（`{freshness:{status:'unknown',reason_code:'impact_anchor_missing'},unclaimed_files:['DoD.md'],affected_nodes:[],required_assertions:[]}`）。谁/何时/何环境：evaluator 跑 pg.integration + Final E2E 时，真 Postgres 上验证消费链完整。
- 其余无 mock 豁免。

## 禁 mock 边清单

本单改动涉及：状态机（impact 结论分类 + 确定性出口路由）、跨模块数据传递（reason_code/detail 从 diff-gate → harness-gates → loop）、DB 写路径（`orchestrator_decision_log` append）。因此：

- **diff-gate.js 分类逻辑 ↔ harness-gates.js gateReceipt**：pg.integration/E2E 测试必须真调 `createHarnessImpactGates` 的真实 `beforeEvaluate` + 真实 `evaluateDiffGate`（不得用 stub 顶替 diff-gate 或 gateReceipt）。
- **loop.js impact 结论 ↔ orchestrator_decision_log 表**：Final E2E 必须真 `appendHop` 写真 Postgres，psql 真查落行（不得 mock appendHop / 不得只断言内存对象）。
- **loop.js impact 结论 ↔ derive 路由**：loop 路由测试用真 `runLoop` + 真 `derive`（既有 loop.test.js 模式：fake `collectGroundTruth` 喂 observed、fake `dispatch` 记录动作，但 derive 与 loop 决策逻辑本体不 mock）。
- **允许 mock 的更外层无关依赖**：mapper HTTP（`/map/radius` / `queryImpactRadius`，radius.js 在范围外）——用 run d1360a48 同形录制响应替身（已登记「未覆盖真实链路清单」）；单元层的 `getActiveContract`/`dispatch`/`writeHeartbeat`/`finalizeRun` 等编排周边（非被改的边）。

diff-gate 纯分类单测（`db:null` + 注入 mapClient）测的是**被改的分类逻辑本体**，mapClient 是范围外 mapper 的替身，不是「被改的边」——合规。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | diff-gate 按 mapper `freshness.reason_code` 三类分流（新鲜度可重试 / 确定性 fail-closed / 未知 fail-closed），透传 reason_code + detail(unclaimed_files, capability_ids)；gateReceipt 透传 detail；loop/derive 对确定性结论按 reason 路由 generator-fix / human_review，不再无限重试 |
| **NFR（做得多好）** | | 消除确定性结论的 kernel 重试路径（原每 90s 重试到 deadline → 现一跳内确定性出口）；无新增延迟阈值 |
| **Invariant（永不违反）** | | INV-1（确定性结论 `retryable:false`）、INV-2（fail-closed 禁静默放行）、INV-3（证据入决策日志）、INV-4（不新增 reason 枚举字面值）、INV-5（真环境落行验证），详见「历史约束三源」表 |
| **判定点（怎么知道）** | | 见「判定点登记表」 |
| **保质期（何时过期）** | | 无 token/数据保质期；分类白名单随 radius.js reason_code 枚举演进——未来 radius 新增 reason_code 默认落 (c) fail-closed，需人评估归 (a) 还是 (b) |
| **死亡告警（停了谁知道）** | | 确定性结论落 `orchestrator_decision_log` + `failure_class=impact_contract_invalid`，run 进 generator-fix/human_review，主理人经既有 human_review 通知知晓；若分类回归失效（确定性结论又被标可重试）→ B-03/B-06 回归用例红 + run 重新空转到 deadline（既有 deadline 兜底） |
| **失败语义（挂了怎么办）** | | 见「失败语义声明」表 |
| **效果确认（已发≠已生效）** | | 每条确定性结论必须在 `orchestrator_decision_log` 落一手证据行（gate_verdict + detail.impact_gate），Final E2E psql 真查确认（B-09）；拿不到落行 = 未生效 = FAIL |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 某 reason_code 属「可重试新鲜度」还是「确定性 fail-closed」 | A. 维护显式白名单集合（新鲜度集 / 确定性集）；B. 按 `freshness.status`（stale=可重试, unknown=确定性） | A. 显式白名单集合（新鲜度集含 fact_snapshot_stale/projection_revision_missing/projection_revision_mismatch/manifest_projection_mismatch/graph_projection_revision_mismatch；确定性集含 impact_anchor_missing/capability_assertion_coverage_missing/capability_not_in_active_projection/unsafe_assertion_ref/assertion_identity_ambiguous），白名单外→(c) fail-closed | 方法 B 不可靠：radius.js 里存在 `status:'unknown'` 却属新鲜度类的 reason_code，按 status 分会误判为确定性 blocked | 误判「新鲜度→确定性」会把真 stale 的可恢复重试掐死误报 human_review；误判「确定性→新鲜度」会退回本 sprint 要修的无限重试黑洞 |
| unclaimed_files 为空但 reason=impact_anchor_missing 时能否 generator-fix | A. 仍派 generator-fix；B. 直接 human_review | B. 直接 human_review | generator-fix 无 unclaimed_files 清单无法定位要删/挪的文件（PRD 边界②） | 派空清单 generator-fix → generator 无从下手 → 再空转一轮 |

> ⚠️ 行属「判定点误判后果严重」级别；PrepPRD 已在 PRD「修法 A/B」明确白名单归类与路由二选一，视为已拍板，无需再升主理人（notes 记 `judgment-pending-user: 无`）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| mapper 返回确定性 reason_code | gate=blocked, retryable=false, 写决策日志, 路由 generator-fix/human_review | 否（确定性结论重试无意义，故 retryable=false） | impact_anchor_missing→generator-fix 一次→仍失败 human_review；coverage_missing→human_review |
| mapper 返回真新鲜度 reason_code | gate=impact_unknown, retryable=true, infrastructure_blocked 退避重试 | 是（新鲜度会随下次扫描恢复） | 既有退避重试到 deadline（行为不变） |
| mapper 返回未知 reason_code | gate=impact_unknown, reason=mapper_contract_invalid, retryable=false, fail-closed | 否 | 走确定性出口（failure_class=impact_contract_invalid），禁静默放行 |
| mapper 不可达 / 抛错 | 既有 `mapper_unavailable`(retryable:true) / catch 分支（行为不变） | 是 | 既有基础设施重试路径，不改 |

### 输入对抗面

N/A —— 本 sprint 不对外暴露 agent 输入；mapper 响应来自 Brain 内部可信 `/map/radius`，`diff-gate` 消费方对 reason_code 已做白名单 + (c) fail-closed 兜底（未知输入不放行）。

---

## E2E 验收（Final E2E — local_api，scratch 库；evaluator 模式 B 独立 task 执行）

> journey_type=autonomous → 无 staging 预览闸。
> 数据写入类 oracle：`orchestrator_decision_log` 落行 + psql 带 5 分钟时间窗（防历史数据冒充）。
> 真 Postgres 由 Fleet 注入 `$DB_URL`（本 attempt 全新空库）；本段脚本先跑仓库真实 migration bootstrap 空库，再跑真实 gate 链落行，最后 psql 断言。
> 被改的边全部真实执行（真 `createHarnessImpactGates` + 真 `evaluateDiffGate` + 真 `runLoop` + 真 `appendHop`）；仅 mapper（radius，范围外）用同形录制响应替身（已登记未覆盖真实链路清单）。
> Final E2E harness（`sprints/08172017-kernel-37cf5c5f/e2e/impact-gate-e2e.mjs`）由 Generator 在实现阶段交付；本段脚本调用它并对真 Postgres 断言落行。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export WORKSPACE_PATH="${WORKSPACE_PATH:-/workspace}"
cd "$WORKSPACE_PATH"
SPRINT_DIR="sprints/08172017-kernel-37cf5c5f"

# 1. 从 $DB_URL 解析 DB_* 环境变量（migrate.js/db-config.js 读 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME）
eval "$(node -e '
  const u = new URL(process.env.DB_URL);
  const q = (s) => (s || "");
  process.stdout.write(
    "export DB_HOST=" + JSON.stringify(q(u.hostname)) + "\n" +
    "export DB_PORT=" + JSON.stringify(q(u.port) || "5432") + "\n" +
    "export DB_USER=" + JSON.stringify(decodeURIComponent(q(u.username))) + "\n" +
    "export DB_PASSWORD=" + JSON.stringify(decodeURIComponent(q(u.password))) + "\n" +
    "export DB_NAME=" + JSON.stringify(q(u.pathname).replace(/^\//, "")) + "\n"
  );
')"
export NODE_ENV=test   # 满足 db-config 测试库 guard（DB_NAME 为 scratch 名，非 cecelia）

# 2. 空库跑仓库真实 migration bootstrap，并机检目标表存在
node packages/brain/src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: migration 后 orchestrator_decision_log 不存在"; exit 1; }

# 3. 跑真实 gate 链落行：generator 交付的 E2E harness（真 runLoop 一跳 + 真 impactGate + 真 appendHop，注入 mapper 录制件）
#    harness 从 $DB_URL 建 pool，seed run/task/active-impact-contract + 候选(changed_files 含 DoD.md)，
#    以本 attempt 的 run_id 落一行 spawn:evaluator intent，gate_verdict=deny:impact:impact_anchor_missing。
RUN_ID=$(node "$SPRINT_DIR/e2e/impact-gate-e2e.mjs")
[ -n "$RUN_ID" ] || { echo "FAIL: E2E harness 未返回 run_id"; exit 1; }

# 4. psql 断言决策日志落行（带 5 分钟时间窗防历史数据冒充）
ROW=$(psql "$DB_URL" -tAc "SELECT gate_verdict, detail->'impact_gate'->>'retryable', jsonb_array_length(COALESCE(detail->'impact_gate'->'unclaimed_files','[]'::jsonb)) FROM orchestrator_decision_log WHERE run_id='$RUN_ID' AND action='spawn:evaluator' AND gate_verdict='deny:impact:impact_anchor_missing' AND created_at > NOW() - interval '5 minutes' ORDER BY hop DESC LIMIT 1")
echo "decision_log row: $ROW"
echo "$ROW" | grep -q 'deny:impact:impact_anchor_missing' || { echo "FAIL: 无 deny:impact:impact_anchor_missing 落行"; exit 1; }
echo "$ROW" | awk -F'|' '{exit ($2=="false")?0:1}' || { echo "FAIL: detail.impact_gate.retryable != false"; exit 1; }
echo "$ROW" | awk -F'|' '{exit ($3+0>=1)?0:1}' || { echo "FAIL: detail.impact_gate.unclaimed_files 为空"; exit 1; }

echo "✅ Final E2E 通过：确定性结论 fail-closed 落行，retryable=false，unclaimed_files 非空"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapper 返回 `freshness.status='unknown'` 但 `reason_code` 为 `null`/未定义 → 应落 (c) `mapper_contract_invalid/retryable:false`，不得崩溃或误判可重试。
- 重复提交: 同一候选连续两跳都命中 `impact_anchor_missing` → 第一次 generator-fix、第二次同签名应升 `wait:human_review`，不得无限 generator-fix。
- 中途中断: `unclaimed_files` 为空但 reason=`impact_anchor_missing` → 应直接 human_review（PRD 边界②），不得派空清单 generator-fix。
- 边界值: mapper 同时 `status='stale'`(新鲜度) 且候选含无主文件 → 新鲜度优先，仍 `mapper_stale/retryable:true`（真 stale 不被误判 blocked）。
发现分级: P0/P1（真 stale 被误判 blocked 致误报 human_review，或确定性结论又被标可重试致空转复发）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
