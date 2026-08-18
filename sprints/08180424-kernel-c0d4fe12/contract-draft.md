# Sprint Contract Draft (Round 1)

**Sprint**: Diff Impact Gate 透传 reason_code + 确定性 Map 结论 fail-closed 出口（r19）
**journey_type**: autonomous
**target_environment**: local_api
**baseline**: implementation_baseline.base_sha = `be490e97a596502c3039297d1e26027bc54adc78`（冻结，跨角色不变）

> **锚定父路声明**：独立小路（无父路）——本 sprint 修 orchestration 内部 Impact Gate 的 stale 判定逻辑，无面向用户的父 Golden Path；journey_id=e6f803f2、step_id=aad25bdb 仅作账本归属。

> **Unified Map 半径**：`[MAP_NOT_CONFIGURED]` —— task.payload.map_scope=`["F1"]` 但 map_repo 为空（Unified Map 未配置，见 PRD ASSUMPTION）。无 must_run_assertions，不做领域猜测。

> **contract-gate**: cecelia repo，`packages/brain/src/lib/contract-gate.js` 存在 → 代码层 Contract Gate 生效，本合同断言按「Contract Gate 合规惯用法」书写。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 字面 / N/A）

N/A — 任务无 HTTP 响应。本 sprint 改动全在 Node 模块内部（`impact-contract/diff-gate.js`、`impact-contract/structure-gate.js`、`orchestrator/loop.js` 消费路径），不新增/修改任何 HTTP 端点，返回值是进程内 gate receipt 对象（`{ gate, reason, reason_code, retryable }`）。Registry 端点（api/db/test）查询返回既有系统状态，未发现需对齐的新 HTTP schema。

被消费的进程内 receipt 契约（既有字段，本 sprint 只补齐语义，字面沿用，禁改名）：
- `gate`: `'impact_unknown'`（diff-gate stale）/ `'blocked'`（structure-gate stale）—— 既有值，不改
- `reason`: string —— **本 sprint 改：非 fresh 时携带真实 `reason_code`（缺失才回落裸 `mapper_stale`）**
- `reason_code`: string|null —— **本 sprint 补：透传 `mapperResult.freshness.reason_code`**
- `retryable`: boolean —— **本 sprint 改：确定性 stale → `false`；瞬时/缺失/unknown → `true`**
- `failure_class`（loop 消费侧）: `'impact_contract_invalid'`（确定性）/ `'infrastructure_blocked'`（瞬时）—— 既有枚举，不新增

---

## 已知约束

**回归测试约束（Step 1.2，来自既有测试）**：
- `impact-contract/__tests__/structure-gate.test.js` → 「Mapper stale 响应包含 reason=mapper_stale」（L148-155，注入 `reason_code:'ttl_exceeded'`）—— **本 sprint 必须更新此断言**：折叠成裸 `mapper_stale` 正是被修的 bug，透传后 `reason` 应为 `'ttl_exceeded'`（`ttl_exceeded` 属瞬时 → `retryable:true` 不变，仅 `reason` 断言改）。
- `impact-contract/__tests__/structure-gate.test.js` → 「Mapper stale 响应包含 retryable=true」（L158-165）—— `ttl_exceeded` 瞬时，`retryable:true` 保持，无需改。
- `impact-contract/__tests__/diff-gate.test.js` → fresh/drift/revision_mismatch 路径断言 —— 本 sprint 不动这些路径，须保持绿。
- `impact-contract/__tests__/harness-gates.test.js` → gate 生产接线（`gateReceipt` 把 `result.reason ?? result.reason_code` 映射进 receipt.reason）—— 本 sprint 依赖该映射把真实 reason_code 透传到 loop，须保持绿。

**累积 FR**：`context-manifest` 端点未在本地注入（journey 无历史，PRD「本 line 暂无历史」）→ 无累积 FR 约束。

**Map reason_code 事实来源（`packages/brain/src/map/radius.js`，只消费不新增）**：
- `fact_snapshot_stale`（L82，factHealth 非 fresh）→ **瞬时**（事实扫描会追上）
- `projection_revision_missing`（L85，投影无 revision）→ **瞬时**（投影构建待完成）
- `projection_revision_mismatch`（L88，投影 revision ≠ 已扫描事实）→ **确定性**（投影永久落后/revision 终态错配）
- `manifest_projection_mismatch`（L267，manifest 与投影结构错配）→ **确定性**（结构终态）

---

## Golden Path

[Kernel 调 evaluateDiffGate/evaluateStructureGate 复算 Map] → [透传 freshness.reason_code + 依白名单判定确定性] → [确定性 stale 一次性 fail-closed 收口（retryable:false），loop 归 impact_contract_invalid 不再空转]

### Step 1: orchestrator 在 beforeGenerate/beforeEvaluate 复算 Map，Map 返回非 fresh 且带确定性 reason_code
**来源**: `[FROM_PRD]` — Golden Path 步骤 1（PRD「触发」段）

**可观测行为**: 注入 mock Map 返回 `freshness={status:'stale', reason_code:'projection_revision_mismatch'}`，`evaluateDiffGate` 进入 3a stale 分支。

**验证命令**:
```bash
npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-01"
# 期望：exit 0（gate=impact_unknown 且进入 stale 分支）
```
**硬阈值**: `result.gate === 'impact_unknown'`；对应验证命令见上（B-01）。

---

### Step 2: diff-gate/structure-gate 透传 reason_code，依白名单判定 retryable
**来源**: `[FROM_PRD]` — Golden Path 步骤 2（PRD「系统处理」段）+ 边界情况（缺失/unknown 保守瞬时）

**可观测行为**:
- 确定性 reason_code（`projection_revision_mismatch` / `manifest_projection_mismatch`）→ `reason=<reason_code>`、`reason_code=<reason_code>`、`retryable=false`。
- 瞬时 reason_code（`ttl_exceeded` / `fact_snapshot_stale`）→ `reason=<reason_code>`、`retryable=true`。
- `reason_code` 缺失/为空 → `reason='mapper_stale'`（回落）、`retryable=true`（保守瞬时）。
- `status==='unknown'`（即便 reason_code 命中白名单）→ `retryable=true`（unknown 视为瞬时）。
- structure-gate 同款折叠一致化（避免两 Gate 分叉）。

**验证命令**:
```bash
npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-02"
npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-03"
# 期望：均 exit 0
```
**硬阈值**: 确定性 `retryable===false` 且 `reason===reason_code`；瞬时/缺失/unknown `retryable===true`。命令见上（B-02/B-03）。

---

### Step 3: loop 消费 receipt，确定性 stale → failure_class=impact_contract_invalid，BLOCKED 收口
**来源**: `[FROM_PRD]` — Golden Path 步骤 3（PRD「系统处理」段，loop.js L1539-1544 消费路径）

**可观测行为**: 把真实 gate receipt 直接喂真 classifier `classifyImpactBlockFailureClass`：
- 确定性 receipt（`retryable:false`）→ `impact_contract_invalid`（loop L1661 → `failRun('impact_gate_deterministic:...')` 终止，不重派）。
- 瞬时 receipt（`retryable:true`）→ `infrastructure_blocked`（loop L1666 → backoff 重试，行为不变）。
- `deny:impact:<reason>` 携带真实 reason_code（不再裸 `mapper_stale`）。

**验证命令**:
```bash
npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-04"
# 期望：exit 0
```
**硬阈值**: `classifyImpactBlockFailureClass(确定性 receipt)==='impact_contract_invalid'`；`deny:impact:${det.reason}==='deny:impact:projection_revision_mismatch'`。命令见上（B-04）。

---

### Step 4（出口）: f62c7e87/d1360a48 类空转不复现；瞬时 stale 仍可重试
**来源**: `[FROM_PRD]` — Golden Path 步骤 4（PRD「可观测结果」段）

**可观测行为**: 用 `radius.js` 真实确定性码复现历史输入，确认裸 `mapper_stale` 被消除、确定性 → `impact_contract_invalid`（不无限重派）；瞬时码 `fact_snapshot_stale` 仍 `retryable:true`（双保险不误伤）。

**验证命令**:
```bash
npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-05"
# 期望：exit 0
```
**硬阈值**: 每个确定性码 `reason !== 'mapper_stale'` 且 `retryable===false` 且分类 `impact_contract_invalid`；瞬时码 `retryable===true`。命令见上（B-05）。

---

## 禁 mock 边清单

本单涉及：**状态机**（failure_class 判定 / BLOCKED 终态出口）、**跨模块数据传递**（Map freshness → gate receipt → loop 分类）、**生命周期钩子**（beforeGenerate/beforeEvaluate gate）。禁 mock 被改的边：

- **Map freshness ↔ `classifyMapperStale` ↔ gate receipt**（本单新增/改的边）：测试必须真调 `classifyMapperStale`、`evaluateDiffGate`、`evaluateStructureGate`，**禁 stub/vi.mock 这三者**。
- **gate receipt ↔ `classifyImpactBlockFailureClass`**（本单改的 loop 消费边）：测试必须把**真** gate receipt 直接喂**真** classifier，**禁在两者之间插 mock**。
- **允许 mock 的外层边**：Map HTTP 客户端 `queryImpactRadius`（经 `mapClient` 参数注入 mock）——Map 自身**不在本单范围**（PRD 明确「不改 Map 契约，只消费既有输出」），是更外层的无关依赖，按 PRD E2E 方式注入确定性 `freshness` 输入。
- **DB 边**：本单 stale 分支在任何 DB 访问**之前** return，不触 DB 写路径 → 测试用 `db:null`，**无真 Postgres 要求**（与 runtime_resources.postgres=false 一致）。空 DB 边非因偷懒，而是改动路径确实不碰 DB。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | diff-gate/structure-gate 的 mapper_stale 分支透传 `freshness.reason_code`；确定性 reason_code → `retryable:false`，瞬时/缺失/unknown → `retryable:true`；loop 依 `retryable` 归 failure_class（确定性→impact_contract_invalid 收口）。|
| **NFR（做得多好）** | | 确定性 Map 结论必须一次 fail-closed 收口（禁 retryable:true 无限重派）；瞬时 stale 仍受既有 max_retries 兜底；`deny:impact` receipt 必须携带真实 reason_code。沿用现有 Map 客户端 timeout（PRD 未指定新值）。|
| **Invariant（永不违反）** | | ①非 fresh 一律不放行（gate 仍 impact_unknown/blocked，绝不 pass）；②默认 fail-closed 精神：确定性结论走终态出口；③不新增 Map reason_code 语义；④确定性判定误判为瞬时会退回当前 bug，误判瞬时为确定性会误 block 可重试任务——两向都禁。|
| **判定点（怎么知道）** | | 见下方登记表。|
| **保质期（何时过期）** | | 确定性白名单绑定 `radius.js` 现有 reason_code 语义；若 Map 未来新增/改名 reason_code，需同步维护白名单（跟随 Map 契约演进，非定时过期）。|
| **死亡告警（停了谁知道）** | | 若透传失效退回裸 mapper_stale，回归测试（B-01~B-05，永久 CI）会红；线上退回则表现为 `deny:impact:mapper_stale` + infrastructure_blocked 无限重派，由 run deadline / BLOCKED_SAME_STATE_CAP 兜底并在决策日志可见。|
| **失败语义（挂了怎么办）** | | 见下方失败语义声明。|
| **效果确认（已发≠已生效）** | | gate receipt 的 `reason`/`reason_code`/`retryable` 字段值即回执；loop `failure_class` + `failRun('impact_gate_deterministic:...')` / backoff 分支即生效证据。回执由 B-01~B-05 断言机检。|

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ Gate 如何判定一个非 fresh Map 结论是「确定性」还是「瞬时」 | A. 信任 Map 侧 reason_code 分类字段（本 sprint 不改 Map，无此字段）; B. Gate 侧维护确定性 reason_code 白名单 + `status==='stale'` + reason_code 非空 | B. Gate 侧白名单：`{projection_revision_mismatch, manifest_projection_mismatch}`，且 `status==='stale'` 且 reason_code 非空才确定性；其余（含 unknown/缺失/未知码）保守瞬时 | PRD ASSUMPTION：Map 未产出可区分字段则 Gate 侧兜底白名单；未知码保守当瞬时避免过度 fail-closed（有 max_retries 双保险） | 误判确定性为瞬时→无限空转（当前 bug f62c7e87/d1360a48）；误判瞬时为确定性→过早终止本可重试成功的任务（丢任务/面客） |
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | — | — | — |

> ⚠️ 判定点属「误判后果严重（丢任务/无限空转）」级别 → 见 contract-dod.md notes `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Map 返回确定性 stale reason_code | gate `impact_unknown`/`blocked` + `retryable:false`；loop → `impact_contract_invalid` → `failRun('impact_gate_deterministic:...')` 终止 | 不重派（终态，幂等：同输入恒返 retryable:false） | 转人工/repair（既有 impact_contract_invalid 语义），不重派 |
| Map 返回瞬时 stale / reason_code 缺失 / status unknown | gate `impact_unknown`/`blocked` + `retryable:true`；loop → `infrastructure_blocked` → backoff | 幂等重试（既有语义不变） | 既有 max_retries 兜底双保险 |
| Map 抛错 / 不可达 | 既有 `mapper_unavailable` 分支不变（retryable:true） | 幂等重试 | 不在本 sprint 改动范围 |

### 输入对抗面

N/A —— 本 sprint 无对外暴露 agent 输入；消费的是内部 orchestration 复算的 Map freshness 对象，非外部用户可写入的接口。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 改动路径（stale 分支 + loop 分类）为纯进程内决策逻辑，在任何 DB 访问之前 return（`db:null` 即可覆盖），**不依赖 Postgres、不新增 HTTP 端点**（与 runtime_resources.postgres=false 一致）。故 local_api 的 DB migration/signup 自举模板 **N/A**——真实 oracle 是用真 gate 函数 + 真 classifier 执行、仅在 Map HTTP 边界注入确定性 freshness 的 Node 单测（vitest），收 exit code。以下脚本按序执行三段：sprint 回归（repo 根 vitest）+ packages/brain 既有 gate 套件（子 shell 用包自身 vitest 配置，遵 9.25.0 死规则）。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

SPRINT_TEST="sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts"

# 1. sprint 回归（sprints/** 在根 vitest include 内，从仓库根跑；真 gate + 真 classifier，仅 Map 边界注入 mock）
echo "▶ [1/2] sprint 回归 B-01~B-05"
npx vitest run "$SPRINT_TEST" --reporter=dot
echo "✅ sprint 回归全过"

# 2. packages/brain 既有 gate 套件（9.25.0 死规则：packages/<pkg>/src/** 必须子 shell cd 进包根，用包自身 vitest 配置）
echo "▶ [2/2] packages/brain diff-gate + structure-gate 既有套件（含更新后的 stale 断言）"
( cd packages/brain && npx vitest run --no-cache \
    ./src/impact-contract/__tests__/diff-gate.test.js \
    ./src/impact-contract/__tests__/structure-gate.test.js \
    ./src/impact-contract/__tests__/harness-gates.test.js )
echo "✅ packages/brain gate 套件全过（确定性 stale reason_code 透传 + 一致化）"

echo "✅ Golden Path 全程验证通过：确定性 Map 结论一次性 fail-closed 收口，裸 mapper_stale 空转不复现"
```

---

## 未覆盖真实链路清单

| 被替身顶替的链路点 | 为什么 | 真验证补位计划 |
|---|---|---|
| Map HTTP 复算（`queryImpactRadius`）经 `mapClient` 注入 mock freshness | PRD 明确「不改 Map 契约，只消费既有输出」——Map 自身在本 sprint 范围外，是更外层依赖；PRD 指定的验证方式即「注入 mock Map」。被测的 gate 判定逻辑与 loop 分类**全部真实执行**，非替身。 | 确定性白名单成员严格绑定 `packages/brain/src/map/radius.js` 真实产出的 reason_code（`projection_revision_mismatch`/`manifest_projection_mismatch`/`fact_snapshot_stale` 等），非臆造；Map 侧 reason_code 若演进由维护白名单跟随。真实 Map→Gate 全链在既有 `impact-contract-loop.integration.test.js`（需 PG）覆盖，本 sprint 不改该链路，故不重复真机跑（runtime postgres=false）。 |

> 说明：本清单登记的**唯一**替身点是 PRD 排除范围外的 Map 边界，属规则 C 的显式登记（非隐藏假绿）。被改的边（classifyMapperStale / gate retryable 透传 / loop 分类）无一 mock，见「禁 mock 边清单」。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness` 为 `null` / `undefined`（Map 返回体缺 freshness 字段）→ 应走 stale 分支且 `retryable:true`（缺信息保守瞬时），不得抛异常。
- 错输入: `reason_code` 为空串 `''` 或非字符串（数字/对象）→ 应视同缺失，回落 `mapper_stale` + `retryable:true`。
- 边界值: `status:'stale'` 但 reason_code 是白名单外的未知码（如 `'foobar_stale'`）→ 保守瞬时 `retryable:true`（不过度 fail-closed）。
- 一致性: 同一 freshness 输入喂 diff-gate 与 structure-gate，`reason`/`reason_code`/`retryable` 三字段必须一致（禁两 Gate 分叉）。
- 重复提交: 同确定性输入连调两次 evaluateDiffGate → 结果确定（幂等），classifyImpactBlockFailureClass 恒返 impact_contract_invalid。
发现分级: P0/P1（确定性被误判为瞬时=无限空转 / 瞬时被误判为确定性=误 block）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性 diff-gate fail-closed | `tests/mapper-stale-fail-closed.test.ts` | B-01 deterministic stale diff-gate、B-05 regression | import `mapper-stale.js` / `impact-block-classify.js` 失败 + retryable 断言失败 → N failures |
| 瞬时/缺失/unknown retryable | `tests/mapper-stale-fail-closed.test.ts` | B-02 transient stale diff-gate | reason 仍为裸 mapper_stale → 断言失败 |
| structure-gate 一致化 | `tests/mapper-stale-fail-closed.test.ts` | B-03 structure-gate | reason 仍为 mapper_stale + reason_code 缺失 → 断言失败 |
| loop 分类 | `tests/mapper-stale-fail-closed.test.ts` | B-04 loop classify | import classifier 失败 / retryable:true 折叠 → 断言失败 |
