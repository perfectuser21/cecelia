# Sprint Contract Draft (Round 1)

> 锚定父路声明：独立小路（无父路）——本 sprint 修复 kernel impact gate 内部确定性空转坑，不推进某条既有 Golden Path 业务步骤。
> gp-anchor: skipped (product-map.json not found)
> contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，走代码层 gate；本合同按合规惯用法速查表书写）
> map-radius: [MAP_NOT_CONFIGURED]（task.payload.map_repo=null、expected_files=null，无法计算影响半径；map_scope=["F1"] 仅记录，不回退领域硬编码）
> journdy 上下文：postgres 运行资源为 false，本 sprint 被测逻辑为纯 gate 判定（DB 仅读合同、单元层注入桩），不依赖真实 Postgres。

## Response Schema（推导来源: PRD 字面 — N/A）

N/A — 任务无 HTTP 响应。本 sprint 改动是 `evaluateDiffGate` 的返回对象（内部函数结果）与 `gateReceipt` 收据字段，不新增/变更任何 HTTP 端点。Reviewer 第 6 维 verification_oracle_completeness 就 HTTP schema 项自动满分；BEHAVIOR 覆盖以 gate 结果对象字段 + 收据字段为 oracle。

被改动的**结果对象契约**（非 HTTP，供下游 kernel 消费）：

`evaluateDiffGate(...)` 在步骤 3a（`freshness.status !== 'fresh'`）返回：
```json
{
  "gate": "impact_unknown",
  "reason": "<真实 reason_code | 缺失时回退 'mapper_stale'>",
  "reason_code": "<mapperResult.freshness.reason_code | null>",
  "retryable": "<boolean：确定性结论 false / 瞬时或缺失 true>"
}
```
`gateReceipt(stage, result)` 收据新增/透传字段：
```json
{ "reason": "<result.reason ?? result.reason_code>", "reason_code": "<result.reason_code ?? null>", "retryable": "<result.retryable ?? false>" }
```

**确定性 reason_code 名单（依 map/radius.js 生产端锚定）**——出现即 `retryable:false`（fail-closed 终态 deny）：
`projection_revision_mismatch`、`manifest_projection_mismatch`、`graph_projection_revision_mismatch`、`capability_not_in_active_projection`、`impact_anchor_missing`、`unsafe_assertion_ref`、`assertion_identity_ambiguous`、`capability_assertion_coverage_missing`（语义：Map 层结论为结构性/revision 不一致，重跑同一 gate 永不转 fresh）。

**瞬时 staleness 白名单（TRANSIENT_FRESHNESS_REASON_CODES）**——保留 `retryable:true`：
`fact_snapshot_stale`（事实扫描过期，后台重扫可转 fresh）、`projection_revision_missing`（投影 revision 未落，投影构建 pending）。
以及 `reason_code == null`（缺失）→ 退回旧瞬时语义 `retryable:true`。

> 判定实现建议：`const retryable = reasonCode == null || TRANSIENT_FRESHNESS_REASON_CODES.has(reasonCode);`（白名单显式，默认 fail-closed；新出现的非 null 未知码按确定性处理，方向与本 sprint「消灭无限重试」一致，符合 Invariant [失败不降级]）。

## Golden Path

[kernel 在某 task 的 impact gate 调 evaluateDiffGate] → [Mapper 返回确定性非 fresh 结论 + reason_code] → [gate 透传真实 reason_code 且依确定性判 retryable] → [收据展示真码、确定性场景 retryable=false，kernel 停止空转落终态]

### Step 1: kernel 触发 impact gate，Mapper 返回确定性非 fresh 结论
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条（触发条件）+「背景」段直接定义。

**可观测行为**: `evaluateDiffGate` 走到步骤 3a（`mapperResult.freshness.status !== 'fresh'`），`freshness.reason_code` 为一个确定性码（如 `projection_revision_mismatch`）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08212023-kernel-df8f8d37/tests/diff-gate-reason-code.test.js -t '确定性结论（projection_revision_mismatch' --reporter=dot 2>&1 | grep -qE '[1-9][0-9]* passed' && echo OK || { echo FAIL; exit 1; }
```
**硬阈值**: `result.gate === 'impact_unknown'` 且 `result.reason_code === 'projection_revision_mismatch'`。

---

### Step 2: gate 透传 reason_code + 依确定性判 retryable（fail-closed 出口）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条（系统处理）。

**可观测行为**: 3a 出口不再一律折叠 `reason:'mapper_stale'+retryable:true`；确定性码 → `reason=真码、reason_code=真码、retryable:false`；瞬时码/缺失 → `retryable:true`（reason 展示真码，缺失回退 `mapper_stale`）。确定性判定以 reason_code 为准，不看 `status` 字面（`unknown` 与 `stale` 同规则）。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08212023-kernel-df8f8d37/tests/diff-gate-reason-code.test.js -t '确定性结论以 reason_code 为准' --reporter=dot 2>&1 | grep -qE '[1-9][0-9]* passed' && echo OK || { echo FAIL; exit 1; }
```
**硬阈值**: `status:'unknown'+reason_code:'capability_not_in_active_projection'` → `retryable === false`；`status:'stale'+reason_code:'fact_snapshot_stale'` → `retryable === true`。

---

### Step 3: 收据展示真码、retryable=false，kernel 停止 deny:impact:mapper_stale 空转
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条（可观测结果）+「范围限定」的 `gateReceipt` 透传验证。

**可观测行为**: `gateReceipt(stage, result).reason` 展示真实 reason_code（不再裸 `mapper_stale`），并新增结构化 `reason_code` 字段；`retryable` 随 result 透传。kernel `deny:impact:${receipt.reason}`（orchestrator/loop.js:1454）标签变为真码，确定性场景 `retryable===false` 供 kernel 落 blocked 终态。

**验证命令**:
```bash
cd /workspace && npx vitest run sprints/08212023-kernel-df8f8d37/tests/diff-gate-reason-code.test.js -t 'gateReceipt 透传 reason_code' --reporter=dot 2>&1 | grep -qE '[1-9][0-9]* passed' && echo OK || { echo FAIL; exit 1; }
```
**硬阈值**: `receipt.reason === 'projection_revision_mismatch'` 且 `receipt.reason_code === 'projection_revision_mismatch'` 且 `receipt.retryable === false`。

---

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] → 「没有 active contract 时 fail-closed，且不调用 Mapper」（reason:contract_missing, retryable:false — 本 sprint 不得回退）
- [diff-gate.test.js] → 「Mapper 抛出异常 → fail-closed → impact_unknown, retryable:true」（`mapper_unavailable` catch 分支，本 sprint 不改）
- [diff-gate.test.js] → 「同一 base revision 的 projection digest 漂移时刷新合同版本」/「manifest_digest_mismatch, retryable:true」（3b 分支，本 sprint 不改）
- [harness-gates.test.js] → 「未纳入 Impact Contract 治理的存量任务不启用门禁」（exempt 收据，本 sprint 不得破坏）
- [累积FR] context-manifest: 本 line 无历史累积 FR（PRD 已注明「本 line 暂无历史」）
- [生产端锚定] map/radius.js `baseFreshness` 与后续派生给出的 reason_code 词表即本合同确定性/瞬时名单来源（`fact_snapshot_stale`/`projection_revision_missing`/`projection_revision_mismatch`/`manifest_projection_mismatch`/`graph_projection_revision_mismatch`/`capability_not_in_active_projection`/`impact_anchor_missing`/`unsafe_assertion_ref`/`assertion_identity_ambiguous`/`capability_assertion_coverage_missing`）

## 禁 mock 边清单

- `evaluateDiffGate` 步骤 3a：`mapperResult.freshness.reason_code` → gate 结果 `{reason, reason_code, retryable}` 的判定边（**本单改动边**）——测试必须调用**真实** `evaluateDiffGate` 执行该判定，禁止 stub 该函数或替换 3a 分支。
- `gateReceipt(stage, result)` → 收据 `{reason, reason_code, retryable}` 透传边（**本单改动边**）——测试必须调用**真实** `gateReceipt`，禁止桩替。
- 允许注入的外层依赖（非本单改动边，按 impact-contract 单元层既有惯例）：① DB 合同加载（`db.query` 桩，本 sprint 未改合同加载路径）；② Mapper HTTP 边界（`mapClient` 注入，本 sprint 未改 Mapper）。二者是被改边的**外层**依赖，非被改的那条边。
- 说明：本改动是 gate 内**纯判定分支**（freshness→retryable），非 DB 写路径/状态机迁移/跨模块数据接力，故不需真 Postgres；被改的判定边由真实函数执行即满足「禁 mock 被改的边」。

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」链路；被改动的是 kernel 内部 gate 判定，调用方是 kernel 自身（进程内函数调用），无外部 HTTP 认证 shape。

## 未覆盖真实链路清单

- **Mapper HTTP 真调**：单元层用 `mapClient` 注入桩顶替真实 `/api/brain/map/radius` HTTP｜原因：本 sprint 改的是 gate 对 freshness 结论的**消费判定**，非 Mapper 生产端；且 postgres 运行资源为 false，无法起真实 Map 服务端｜真验证补位：`map/radius.js` 是 reason_code 生产权威，本合同的确定性/瞬时名单逐字取自其源码；真实 HTTP 契约由既有 `map-client.test.js` + `map-radius-impact-contract.integration.test.js` 回归覆盖（不在本 sprint 变更面）。
- **kernel 落 blocked 终态**：本 sprint 交付 `retryable:false` 出口，但 kernel 重试调度器「消费 retryable:false → 落 blocked 不再入队」属 PRD 明确「不在范围内」（[ASSUMPTION] 记录）｜真验证补位：由 orchestrator/loop.js 现有 `deny:impact:${receipt.reason}` + `retryable` 消费路径承接，另行 sprint 验证真机 kernel 循环停转。
- 无 `force_*`/假图/dryRun 类作弊桩；DB 桩仅用于加载 active contract（既有单元层惯例，非绕过被测逻辑）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 3a 出口透传 `freshness.reason_code`，依确定性名单判 `retryable`；`gateReceipt` 透传 `reason_code`（不再裸 `mapper_stale`） |
| **NFR（做得多好）** | 非功能 | 沿用 map-client 既有 timeout（PrepPRD 未指定新阈值）；判定为纯同步分支，无额外延迟 |
| **Invariant（永不违反）** | 不变量 | ①null reason_code 必保 `retryable:true`（禁把可刷新 staleness fail-closed 卡死）；②`mapper_unavailable`/`revision_mismatch`/`*_digest_mismatch` 出口行为不变；③同一 reason_code 语义在判定端与收据端一致（Invariant [语义一致]） |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方判定点登记表 |
| **保质期（何时过期）** | 失效 | 确定性名单随 map/radius.js reason_code 词表演进；新增枚举须同步（Invariant [status枚举]） |
| **死亡告警（停了谁知道）** | 告警 | gate 判定错误 → 表现为 task 空转（旧病复发）或误 blocked；由 runs 观测层（如 f62c7e87 复盘同款）发现 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明——fail-closed：未知非 null 码按确定性 `retryable:false` 拦截，不降级放行 |
| **效果确认（已发≠已生效）** | 回执 | `gateReceipt.reason`/`.reason_code`/`.retryable` 即回执；确定性场景 `retryable===false` 可机检 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ 某 reason_code 是否为「确定性终态」（重试永不转 fresh） | A. 显式确定性名单（黑名单确定性码）; B. 显式瞬时白名单（TRANSIENT），其余非 null 按确定性; C. 仅凭 status 字面（stale=瞬时/unknown=确定性） | B. 瞬时白名单（`fact_snapshot_stale`/`projection_revision_missing`）+ null → retryable:true；其余非 null → 确定性 retryable:false | 生产端 map/radius.js 仅两类码代表「数据层未追上（可重扫/重建）」，其余皆结构性/revision 不一致（重试无效）；白名单显式且默认 fail-closed，符合「消灭无限重试」目标与 Invariant [失败不降级]；C 被 PRD 边界情况明确否定（不得仅凭 status 拍板） | 误判瞬时为确定性 → 本可自愈的 task 被 blocked（面客/丢进度）；误判确定性为瞬时 → 原 mapper_stale 无限重试空转复发 |

> judgment-pending-user: 「某 reason_code 是否为确定性终态」的具体名单在 PrepPRD/对齐会未逐条拍板（PRD [ASSUMPTION] 注明「由 Proposer 依 map-client 契约与 Map 服务端实现在合同阶段锚定」）。本合同已依 map/radius.js 生产端源码锚定，若主理人对 `projection_revision_missing` 归瞬时（而非确定性）有异议可在 Reviewer/对齐环节校正。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写 DB | 是 | 客户端重试 |
| 未知非 null reason_code（不在瞬时白名单也不在已知确定性名单） | 按确定性处理 `retryable:false`（fail-closed 拦截，落终态） | 是（纯判定，同输入同输出） | 不降级放行——宁可 blocked 待人工核对，不放任无限重试 |
| reason_code 缺失/null | `retryable:true`（保留旧瞬时语义） | 是 | 允许 kernel 按原节奏重试（可刷新 staleness 不卡死） |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent 入口；输入为 kernel 进程内 `mapperResult`（来自受信 Map 服务），非外部用户可写入面。

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 被测逻辑为纯 gate 判定：DB 仅用于加载合同（单元层注入桩），Mapper 为注入桩，**不依赖真实 Postgres**（runtime postgres=false 与之一致）。故 E2E 以仓库真实代码上的 vitest 断言为 oracle：冻结 sprint 测试从仓库根跑（落 sprints/**，命中根 vitest include）；packages/brain 既有回归测试用子 shell 切进包根跑（用该包自己的 vitest 配置，避免命中根 include 报 No test files found）。

```bash
#!/bin/bash
set -euo pipefail
cd /workspace

# 1. 冻结 sprint 测试（根 vitest include 覆盖 sprints/**）——本单核心 oracle 全过
npx vitest run sprints/08212023-kernel-df8f8d37/tests/diff-gate-reason-code.test.js --reporter=dot 2>&1 | tee /tmp/sprint-green.log
grep -qE 'Tests +[6-9]|Tests +[1-9][0-9]+' /tmp/sprint-green.log || { echo "FAIL: 冻结测试通过数不足"; exit 1; }
grep -qiE '[0-9]+ +failed' /tmp/sprint-green.log && { echo "FAIL: 冻结测试存在失败"; exit 1; } || true

# 2. packages/brain 既有 impact-contract 回归（用包自身 vitest 配置，子 shell 切进包根）——无回退
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/harness-gates.test.js --reporter=dot) 2>&1 | tee /tmp/brain-green.log
grep -qiE '[0-9]+ +failed' /tmp/brain-green.log && { echo "FAIL: brain 回归存在失败"; exit 1; } || true

# 3. 确定性出口断言直读（node 断言真实代码返回值，非文本自证）
node --input-type=module -e '
import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js";
import { gateReceipt } from "./packages/brain/src/impact-contract/harness-gates.js";
const db = { query: async () => ({ rows: [{ id:"c1", repo:"cecelia", change_kind:"bugfix", base_revision:"base", manifest_digest:null, projection_digest:null, contract_body:{ affected_capabilities:[{capability_id:"impact-contract"}], required_assertions:[] } }] }) };
const det = await evaluateDiffGate({ db, taskId:"t", repo:"cecelia", headRevision:"head", mapClient: async () => ({ freshness:{ status:"stale", reason_code:"projection_revision_mismatch" } }) });
if (det.reason_code !== "projection_revision_mismatch" || det.retryable !== false) { console.error("FAIL det", det); process.exit(1); }
const r = gateReceipt("diff", det);
if (r.reason !== "projection_revision_mismatch" || r.reason_code !== "projection_revision_mismatch" || r.retryable !== false) { console.error("FAIL receipt", r); process.exit(1); }
const tr = await evaluateDiffGate({ db, taskId:"t", repo:"cecelia", headRevision:"head", mapClient: async () => ({ freshness:{ status:"stale", reason_code:"fact_snapshot_stale" } }) });
if (tr.retryable !== true || tr.reason_code !== "fact_snapshot_stale") { console.error("FAIL transient", tr); process.exit(1); }
const nul = await evaluateDiffGate({ db, taskId:"t", repo:"cecelia", headRevision:"head", mapClient: async () => ({ freshness:{ status:"stale" } }) });
if (nul.retryable !== true || (nul.reason_code ?? null) !== null) { console.error("FAIL null", nul); process.exit(1); }
console.log("OK: 确定性 fail-closed + 瞬时/缺失保留重试 + 收据透传 均通过");
' || { echo "FAIL: node 出口断言未通过"; exit 1; }

echo "✅ Golden Path 验证通过（reason_code 透传 + fail-closed 出口）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness` 为 `undefined`/`{}`（无 status 字段）→ 应仍走 3a（`!mapperResult?.freshness` 分支），`reason_code` 为 null → `retryable:true`，不得抛异常
- 错输入: `reason_code` 为非字符串（如数字/对象）→ 不在白名单 → 按确定性 `retryable:false`，不得崩溃
- 重复提交: 同一确定性 `mapperResult` 连跑两次 `evaluateDiffGate` → 结果幂等（同 `reason_code`/`retryable`）
- 边界值: 白名单码大小写/前后空格变体（如 `Fact_Snapshot_Stale`）→ 不命中白名单 → 按确定性处理（词表精确匹配，不做模糊）
- 中途中断: 3a 命中后不得意外落入 3b/对账（确定性/瞬时都应在 3a return，不继续 revision/digest 检查）
发现分级: P0/P1（把可刷新 staleness 误 fail-closed 卡死 / 确定性码仍无限重试）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 3a reason_code 透传 + fail-closed（冻结） | `sprints/08212023-kernel-df8f8d37/tests/diff-gate-reason-code.test.js` | 确定性结论（projection_revision_mismatch / 确定性结论以 reason_code 为准 / 瞬时 staleness（fact_snapshot_stale / 瞬时 staleness（projection_revision_missing / reason_code 缺失 / gateReceipt 透传 reason_code | 修复前 5 failed \| 1 passed（reason_code undefined、retryable 恒 true、gateReceipt 未导出）|
| impact-contract 回归（补充，既有 repo 测试） | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | 不回退既有 contract_missing / mapper_unavailable / manifest_digest_mismatch 出口 | 补充行，非冻结产物 |
