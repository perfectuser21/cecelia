# Sprint Contract Draft (Round 1) — Diff Impact Gate 确定性 reason_code 透传 + fail-closed 出口

## 锚定父路声明

覆盖父路 journey e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 / step aad25bdb（Diff Impact Gate 确定性→fail-closed 出口）第 1-5 步。

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` → `Mapper revision mismatch 时 Diff Gate 返回 blocked`（现断言 `retryable: true`，本 sprint 反转为 `false`）
- [回归] `diff-gate.test.js` → `同一 base revision 的 projection digest 漂移时刷新合同版本`（现断言 `manifest_digest_mismatch, retryable: true`，本 sprint 反转为 `false`）
- [回归] `diff-gate.test.js` → `没有 active contract 时 fail-closed`（`contract_missing, retryable: false` — 已确定性，本 sprint 不得回退）
- [回归] `diff-gate.test.js` → `fact_revisions 缺少目标 repo 时返回 impact_unknown`（`revision_evidence_missing, retryable: true` — 属瞬态，本 sprint 保持 true）
- [回归] `diff-gate.test.js` → `Mapper.radius() 超时时 Diff Gate 返回 blocked`（`mapper_unavailable, retryable: true` — 瞬态保持）
- [回归] `packages/brain/src/orchestrator/__tests__/loop.test.js` → `Impact schema 确定性错误精确终止且不进入基础设施重试`（throw 路径 → `impact_gate_deterministic`；本 sprint 补 resolved-receipt 路径）
- [回归] `loop.test.js` → `transient infrastructure BLOCKED backs off and re-probes`（`infrastructure_blocked` → `sleep(POLL_INTERVAL_MS)` 退避 — 瞬态语义不得破坏）
- [累积FR] context-manifest: 本 line（journey e6f803f2）当前仅含 planned ability，无 done/working，无历史行为约束。
- [MAP_NOT_CONFIGURED] task.payload.map_repo=null、expected_files=[]（map_scope=["F1"] 但无 repo）→ 影响半径不可算，must_run_assertions 为空，不回退到领域硬编码。

## Response Schema（推导来源: 现有 diff-gate.js / structure-gate.js 返回结构 SSOT + PRD Golden Path 推导）

> 本 sprint 无新增 HTTP 端点。「Response」= 三个内核决策点的返回契约（模块级 SSOT）：
> ① `evaluateDiffGate()` 返回对象 ② `evaluateStructureGate()` 返回对象 ③ orchestrator `runLoop` 的 `gateVerdict` / `failRun(reason)` / `exitReason`。

### 决策点 ①: `evaluateDiffGate(...)` → object（`packages/brain/src/impact-contract/diff-gate.js`）

不可判定早返回形态：
```json
{"gate": "impact_unknown", "reason": "<reason_code>", "retryable": <bool>}
```

`reason` 与 `retryable` 的**权威分桶**（本 sprint 唯一实质改动）：

| reason_code（字面，禁改名） | 类别 | retryable | 变更 |
|---|---|---|---|
| `revision_mismatch` | 确定性（base_sha 冻结下重试不自愈） | `false` | **本次反转（旧=true）** |
| `manifest_digest_mismatch` | 确定性 | `false` | **本次反转（旧=true）** |
| `projection_digest_mismatch` | 确定性 | `false` | **本次反转（旧=true）** |
| `contract_missing` | 确定性 | `false` | 保持（已确定性） |
| `mapper_stale` | 瞬态（freshness 刷新中，下轮会变） | `true` | 保持 |
| `mapper_unavailable` | 瞬态（Mapper 不可达） | `true` | 保持 |
| `db_unavailable` | 瞬态（DB 不可达） | `true` | 保持 |
| `revision_evidence_missing` | 瞬态（证据缺失可补齐） | `true` | 保持 |
| `git_diff_unavailable` | 瞬态 | `true` | 保持 |
| `contract_extend_write_failed` / `gap_ledger_write_failed` | 瞬态（写重试） | `true` | 保持 |

- `gate` (string, 必填): `pass`/`extend`/`drift`/`blocked`/`impact_unknown`。
- `reason` (string, 必填于 impact_unknown): 上表字面值，**原样透传，禁止折叠成 `mapper_stale`**。
- `retryable` (bool, 必填于 impact_unknown): 按上表分桶。
**禁用字段名**: 不得把确定性 reason 改写成 `mapper_stale`；不得新增 `stale` 泛化桶吞掉具体 reason_code。

### 决策点 ②: `evaluateStructureGate(...)` → object（`packages/brain/src/impact-contract/structure-gate.js`）

```json
{"gate": "blocked", "reason": "<reason_code>", "retryable": <bool>, "httpStatus": <int>}
```
- 语义一致铁律：同一 reason_code 在 structure-gate 与 diff-gate 必须**同一 retryable 分桶**。
- `revision_mismatch` (httpStatus 409): `retryable=false`（**本次反转**，旧代码 `retryable = httpStatus===409` 恒为 true）。
- `revision_evidence_missing` (httpStatus 409): `retryable=true`（瞬态，保持）——证明修复不是"把 409 全刷成 false"的偷懒。
- `mapper_stale`/`mapper_unavailable` (httpStatus 503): `retryable=true`（瞬态，保持）。

### 决策点 ③: orchestrator `runLoop`（`packages/brain/src/orchestrator/loop.js`）

- 确定性 receipt（`gate ∈ {impact_unknown,blocked}` 且 `retryable===false`）：
  - `intent.gateVerdict = "deny:impact:<具体reason_code>"`（非 mapper_stale）
  - `result.failure_class = "impact_contract_invalid"`
  - `failRun("impact_gate_deterministic:<reason>")`，`exitReason = "impact_gate_deterministic"`，**不 `sleep`，不派发 dispatch**（0 退避）。
- 瞬态 receipt（`retryable===true`）：`failure_class = "infrastructure_blocked"` → `sleep(POLL_INTERVAL_MS)` 有限退避（受 deadline + 同态 2 次 `blocked_same_state` 上限约束）。

**Error (无 HTTP)**: N/A — 本 sprint 无 HTTP 4xx 响应，错误语义由 `failRun(reason)` 承载。

---

## Golden Path

[orchestrator beforeGenerate/beforeEvaluate/beforeMerge 调 Impact Gate] → [Gate 复算 Map 影响半径判定确定性] → [确定性 deny 立即 fail-closed / 瞬态 stale 有限重试]

### Step 1: orchestrator 派发前调 Impact Gate，Gate 调 Mapper 复算影响半径
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步（第 22 行）。

**可观测行为**: `evaluateDiffGate`/`evaluateStructureGate` 以 head revision 复算影响半径并与 active contract 对账，产出裁决对象。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js) 2>&1 | grep -Eq "Test Files.*passed|passed \(" || exit 1
```
**硬阈值**: diff-gate 套件全过（exit 0）。

---

### Step 2: 瞬态 stale/unavailable → 透传具体 reason_code + retryable=true
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（第 23 行）+ 边界情况（第 32 行）。

**可观测行为**: `mapper_stale` / `mapper_unavailable` / `revision_evidence_missing` 保留 `retryable:true`，交 kernel 有限重试；reason_code 原样返回，不被本次改动误判为确定性。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "瞬态") 2>&1 | grep -Eq "passed" || exit 1
```
**硬阈值**: 瞬态用例断言 `retryable===true` 全过。

---

### Step 3: 确定性结论（revision/digest mismatch）→ 原样透传 reason_code + retryable=false（本次核心修复）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步（第 24 行）；`[AI_ADDED]` structure-gate 语义对齐（防两端语义分叉开假绿面，Invariant [语义一致]）。

**可观测行为**: `revision_mismatch` / `manifest_digest_mismatch` / `projection_digest_mismatch` 返回**该具体 reason_code**（非 mapper_stale）且 `retryable:false`；structure-gate 同 reason 同分桶。

**验证命令**:
```bash
npx vitest run sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts 2>&1 | grep -Eq "passed" || exit 1
```
**硬阈值**: 确定性用例断言 `retryable===false` 且 `reason` 为具体码（非 mapper_stale）全过。

---

### Step 4: 确定性 deny → orchestrator 立即 failRun，无 90s 退避（fail-closed 出口）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步（第 25 行）+ NFR 重试有界（第 64 行）。

**可观测行为**: 确定性 receipt 使 `gateVerdict=deny:impact:<reason>`、`failure_class=impact_contract_invalid`、`failRun('impact_gate_deterministic:<reason>')`、`exitReason='impact_gate_deterministic'`，`sleeps` 为空、`dispatch` 未被调用。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js -t "impact_gate_deterministic") 2>&1 | grep -Eq "passed" || exit 1
```
**硬阈值**: loop 确定性精确终止用例全过，`sleeps == []`。

---

### Step 5: 真瞬态 stale 保留有限重试语义（回归不破坏）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步（第 26 行）+ 边界情况 blocked_same_state（第 34 行）。

**可观测行为**: 瞬态 receipt → `failure_class=infrastructure_blocked` → `sleep(POLL_INTERVAL_MS)` 退避；连续同态 BLOCKED ≥2 次的 `blocked_same_state` 兜底不回退。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js -t "infrastructure BLOCKED backs off") 2>&1 | grep -Eq "passed" || exit 1
```
**硬阈值**: 瞬态退避用例全过（`sleeps == [POLL_INTERVAL_MS, POLL_INTERVAL_MS]`）。

---

## 真实调用方请求 shape

N/A — 本 sprint 无外部设备/agent 调服务端。改动全在 Brain 进程内核（impact gate 决策 + orchestrator 控制流），调用方是 orchestrator `runLoop` 自身，通过 `deps.impactGate.beforeGenerate/beforeEvaluate/beforeMerge` 注入接缝调用 `evaluateDiffGate`/`evaluateStructureGate`（同进程函数调用，无网络/认证边界）。

## 禁 mock 边清单

本单涉及**状态机（BLOCKED→failRun 终态判定）**与**跨模块数据传递（gate reason_code/retryable 经 harness-gates receipt 接力到 orchestrator failure_class 路由）**，故以下边禁 mock：

- **`evaluateDiffGate` 决策逻辑（确定性 vs 瞬态 retryable 分桶）**：测试必须真跑 `diff-gate.js`，只允许注入 `mapClient`（Mapper 外部边界）与 stub `db.query`（只读 contract 行，非被改逻辑）。禁止 mock `evaluateDiffGate` 本体。
- **`evaluateStructureGate` 决策逻辑**：同上，真跑 `structure-gate.js`，只注入 `mapClient`。
- **harness-gates `gateReceipt` reason_code/retryable 透传边**：`beforeEvaluate` 真调 `diffGate` 并原样携带 `reason`+`retryable`（`harness-gates.test.js` 覆盖，不得 stub gateReceipt）。
- **orchestrator `runLoop` 的 receipt→failure_class→failRun 路由边**：`loop.test.js` 真跑 `runLoop` 决策逻辑；`deps.impactGate` 按 loop 既有依赖注入契约注入合成 receipt（这是 loop 设计上的注入点，非被改边——被改边是 loop 内部 `retryable===false → impact_contract_invalid` 的分类逻辑，真跑）。

**无 DB 写路径被改动**：本次修改集中在 diff-gate/structure-gate 的**不可判定早返回**（发生在任何 INSERT/UPDATE 之前）与 loop 的**既有** failRun 路由（未改 `markRunFailed`）。stub `db.query` 仅用于喂 active contract 只读行，不覆盖任何被改写路径，故不需真 Postgres（且 runtime_resources.postgres=false）。

## 未覆盖真实链路清单

- **running-Brain local_api curl+psql 全链**（真实 orchestrator run 触发 → 观察 run failed 无退避）：**未覆盖**。
  - 为什么：① 本改动是内核内部控制流（`evaluateDiffGate`/`runLoop`），**无对应 HTTP 端点**可单条 curl 触发"构造确定性 revision_mismatch → 观察 failRun 无退避"；② `runtime_resources.postgres=false`，无 attempt 级 Postgres 可跑真实 harness run。
  - 真验证补位计划：谁=kernel harness 全链自身（本 r20 run 即在验证 publish→全链）；何时=本 fix 合并后下一次真实 kernel run 命中确定性 gate 时；环境=生产 orchestrator（loop.js 的 `impact_gate_deterministic` exitReason 已在生产路径接线，见 loop.js:1661-1664）。
  - 呈现：harness-controller 将本清单原样带入 PR 描述。
- 其余链路无 mock 豁免。

## 接缝清单（接缝 vs 逻辑）

- 本 sprint **全部为逻辑断言**（环境无关的纯决策逻辑：reason_code 透传 + retryable 分桶 + failure_class 路由）。CI/vitest 绿 = 真 done。
- 唯一贴近接缝的点：生产 orchestrator 的 `failRun` 真实写 run 终态——但该写路径**本次未改动**（复用既有 `markRunFailed`），且已在生产 loop.js 接线，属既有行为，本 sprint 以 loop.test 的真跑路由逻辑覆盖，标 `logic-done`（无待真验接缝）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR** | 系统对外承诺 | 确定性 Map 结论（revision/digest mismatch）Impact Gate 原样透传具体 reason_code 且 retryable=false；orchestrator 据此立即 fail-closed（failRun），不进入 90s 退避 |
| **NFR** | 性能/可靠性阈值 | 重试有界：确定性 deny 0 重试；瞬态重试受 run deadline + 同态 2 次上限约束（沿用现有常量，不改 90s/deadline） |
| **Invariant** | 永不违反 | [语义一致] 同一 reason_code 在 diff-gate 与 structure-gate（判变端）与 loop（终验端）必须同一 retryable/处理策略；[失败不降级] 确定性 deny 显式 failRun 非零终态，禁 warning 降级 |
| **判定点** | 对模糊现实的判断 | 见判定点登记表 |
| **保质期** | 何时过期 | N/A — 决策逻辑随 base_sha 冻结即时判定，无 token/缓存保质期 |
| **死亡告警** | 停了谁知道 | 确定性 deny 使 run 立即 failed（可观测），替代旧的"静默退避到 deadline"；run failed 经既有 harness 监控可见 |
| **失败语义** | 挂了怎么办 | 见失败语义声明 |
| **效果确认** | 已发≠已生效 | `intent.gateVerdict=deny:impact:<reason>` + `run.failure_reason=impact_gate_deterministic:<reason>` 原样落库为回执；拿不到具体 reason_code（被折叠成 mapper_stale）= 未生效 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ Map 结论"确定性 vs 瞬态"归类 | A. 按 Gate 返回 reason_code 类别静态分桶; B. 引入外部探测重算 freshness | A. 按 reason_code 类别分桶（ASSUMPTION: base_sha 冻结下 revision/digest 不一致即确定性） | PRD 假设第 50-51 行：不引入新外部探测，以 reason_code 类别为准 | 误把确定性判瞬态=空转到 deadline（本 bug）；误把瞬态判确定性=真瞬态被过早 fail-closed（回归风险，Step 2/5 守卫） |

> ⚠️ 行说明：该判定点误判两向后果均严重（空转 或 过早 fail），属"升拍板点"级别。PRD 假设段（第 50-51 行）已由 Planner 拍定以 reason_code 类别为准，不引外部探测，故此处不再标 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 确定性 gate deny（revision/digest mismatch） | 立即 `failRun('impact_gate_deterministic:<reason>')`，run/attempt=failed | 否（确定性，重试不变） | 无降级——fail-closed 是目标 |
| 瞬态 gate blocked（mapper_stale/unavailable） | `infrastructure_blocked` 退避 `sleep(POLL_INTERVAL_MS)` | 是（下轮重算） | 有限重试至 deadline / 同态 2 次上限 |

### 输入对抗面

N/A — 无对外暴露 agent；输入来自 orchestrator 进程内部的 Map 复算结果，无外部不可信写入面。

## E2E 验收（final-e2e 跑 — autonomous / target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api（说明：本改动为 Brain 内核内部控制流，无新增 HTTP 端点、无 DB 写路径，且 runtime_resources.postgres=false；oracle 为真实模块决策代码经 vitest 端到端执行——见「未覆盖真实链路清单」）

> vitest 工作目录死规则（9.25.0）：`packages/brain/src/**` 的套件用子 shell `cd packages/brain` 跑该包自身 vitest 配置；`sprints/**` 合同测试从仓库根跑（根 vitest.config include 覆盖 sprints/**）。

```bash
#!/bin/bash
set -euo pipefail

# 0. 生产内核控制流已接线的自证（liveness，不作为业务断言）
curl -sf -m5 localhost:5221/api/brain/health | jq -e '.status=="healthy"' >/dev/null || { echo "FAIL: brain 不可达"; exit 1; }

# 1. 合同确定性→fail-closed 红转绿测试（sprints/ 根跑）
npx vitest run --no-cache sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts 2>&1 | tee /tmp/e2e-sprint.log
grep -Eq "Test Files[[:space:]]+[0-9]+ passed|[0-9]+ passed" /tmp/e2e-sprint.log || { echo "FAIL: 合同确定性测试未过"; exit 1; }

# 2. diff-gate 包内套件（含反转的 revision/digest mismatch 断言）
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ) 2>&1 | tee /tmp/e2e-diffgate.log
grep -Eq "[0-9]+ passed" /tmp/e2e-diffgate.log || { echo "FAIL: diff-gate 套件未过"; exit 1; }

# 3. structure-gate 语义对齐套件
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/structure-gate.test.js ) 2>&1 | tee /tmp/e2e-structgate.log
grep -Eq "[0-9]+ passed" /tmp/e2e-structgate.log || { echo "FAIL: structure-gate 套件未过"; exit 1; }

# 4. orchestrator loop 确定性精确终止 + 瞬态退避回归
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js ) 2>&1 | tee /tmp/e2e-loop.log
grep -Eq "[0-9]+ passed" /tmp/e2e-loop.log || { echo "FAIL: loop 套件未过"; exit 1; }

# 5. harness-gates receipt 透传套件
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/harness-gates.test.js ) 2>&1 | tee /tmp/e2e-hgates.log
grep -Eq "[0-9]+ passed" /tmp/e2e-hgates.log || { echo "FAIL: harness-gates 套件未过"; exit 1; }

echo "✅ Golden Path 验证通过：确定性 reason_code 透传 + retryable=false + fail-closed，瞬态有限重试回归保持"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `evaluateDiffGate` 收到 `freshness.status='fresh'` 但 `fact_revisions` 缺 repo key（应仍 `revision_evidence_missing, retryable=true`，不得被误判成确定性 false）
- 边界值: 三个确定性 reason_code 之外新增/变更的 reason 是否被无意归入确定性桶（须默认瞬态或显式登记）——排查 diff-gate 全部 `impact_unknown` 分支的 retryable 是否与 Response Schema 表逐条一致
- 语义分叉: diff-gate 与 structure-gate 对同一 reason_code 的 retryable 是否出现一处 true 一处 false（[语义一致] 铁律）
- 中途中断: 确定性 deny 后 orchestrator 是否残留 dispatch 副作用（应 `dispatch` 未被调用）
发现分级: P0/P1（确定性空转复现 / 瞬态被过早 fail-closed）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性 revision_mismatch 透传+不重试 | `sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts` | `revision_mismatch 确定性 retryable=false` | 现 diff-gate 返回 retryable:true → 断言失败 |
| 确定性 digest_mismatch 透传+不重试 | 同上 | `manifest_digest_mismatch 确定性 retryable=false` | 现返回 retryable:true → 失败 |
| projection_digest_mismatch 确定性 | 同上 | `projection_digest_mismatch 确定性 retryable=false` | 现返回 retryable:true → 失败 |
| structure-gate 语义对齐 | 同上 | `structure-gate revision_mismatch 确定性 retryable=false` | 现 409→retryable:true → 失败 |
| 瞬态 mapper_stale 保持重试 | 同上 | `mapper_stale 瞬态 retryable=true` | 绿（回归守卫） |
| 瞬态 revision_evidence_missing 保持 | 同上 | `revision_evidence_missing 瞬态 retryable=true` | 绿（防"409 全刷 false"偷懒） |

## gp-anchor: skipped (product-map.json not found)

## contract-gate: enforced (packages/brain/src/lib/contract-gate.js 存在 — cecelia 仓，代码层 Contract Gate 复核；本合同 [BEHAVIOR]/E2E 断言全为 vitest 真跑 exit-code 驱动，按速查表「真跑脚本收 exit code」形态 gate-clean，无 curl-no-jq/count-无时间窗/or-true 命中面)

## notes

- judgment-pending-user: 无（判定点归类由 PRD 假设段拍定）。
- MAP_NOT_CONFIGURED：map_repo 缺失，无 must_run_assertions 注入。
