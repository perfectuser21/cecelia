# Sprint Contract Draft (Round 1)

**锚定父路声明**: 独立小路（无父路）—— 本 sprint 是 F1「造完真验」链路的一个后端裁决缺陷修复，本 line（journey e6f803f2）暂无历史 golden_path，不覆盖既有父路步骤。

**gp-anchor**: skipped (product-map.json not found) —— 当前仓库 cecelia 无 `product-map/generated/product-map.json`，GP-Anchor 段整体跳过，不阻塞。

**contract-gate**: present (packages/brain/src/lib/contract-gate.js 存在，cecelia worktree)——代码层 Contract Gate 生效，本合同断言按速查表 gate-clean 写法。

**Unified Map**: `[MAP_NOT_CONFIGURED]` —— task.payload.map_scope=["F1"] 但 map_repo=null、expected_files=null（Step 1.0 判据 scope+repo 均非空才复算半径）→ must_run_assertions 为空，不折入额外回归约束，禁止回退领域硬编码。

---

## Response Schema（推导来源: PRD 字面 + api_registry 无 HTTP 端点）

**N/A — 任务无 HTTP 响应**。本 sprint 改动为进程内同步裁决函数 `evaluateDiffGate` / `evaluateStructureGate` 的**返回体形状**（非新增 REST 端点），无 curl 可测的 HTTP path。返回体字段契约（作为 jq/oracle 断言 ground truth）如下：

### `evaluateDiffGate(...)` 返回体（步骤 3a stale 分支）

**确定性结论**（`freshness.status !== 'fresh'` 且 `freshness.reason_code` 为非空字符串）:
```json
{"gate": "impact_unknown", "reason_code": "<Mapper 透传的具体原因>", "retryable": false}
```
- `gate` (string, 必填): 恒为 `"impact_unknown"` —— 仍 blocked，不假绿（fail-closed 铁律）。来源: PRD Golden Path Step 2。
- `reason_code` (string, 必填): **字面透传** `mapperResult.freshness.reason_code`（如 `"projection_revision_mismatch"`）。来源: PRD Step 2「透传 Mapper 的 freshness.reason_code」。
- `retryable` (boolean, 必填): 恒为 `false` —— 确定性结论走 fail-closed 出口，不再无限 backoff。来源: PRD Step 2。
- **不得出现**通用 `reason: "mapper_stale"`（会遮蔽具体 reason_code；见禁用字段）。

**真·瞬态**（`freshness.status !== 'fresh'` 且 `freshness.reason_code` 为空/缺失）:
```json
{"gate": "impact_unknown", "reason": "mapper_stale", "retryable": true}
```
- `retryable` (boolean, 必填): 恒为 `true` —— 保留既有 infra 刷新窗口。来源: PRD 边界情况「真·瞬态」。

**禁用字段名**（确定性分支返回体中绝不出现，否则回执被遮蔽）: `reason: "mapper_stale"`（确定性分支只能出 `reason_code`，不能出通用 `reason`）。

### `evaluateStructureGate(...)` 返回体（规则 3 stale 分支，语义一致并修）

**确定性结论**:
```json
{"gate": "blocked", "reason_code": "<透传具体原因>", "retryable": false}
```
**真·瞬态**:
```json
{"gate": "blocked", "reason": "mapper_stale", "retryable": true, "httpStatus": 503}
```
（structure gate 自身 `gate:"blocked"` 约定不变，仅 stale 分支按 reason_code 分流 retryable。）

---

## Golden Path

[Gate 收到确定性 stale 结论] → [透传 reason_code + 判定确定性] → [fail-closed 终止（retryable:false），不空转]

### Step 1: `evaluateDiffGate` 调用 Mapper，Mapper 返回确定性 stale 结论
**来源**: `[FROM_PRD]` — Golden Path 第 1 条（`freshness.status='stale'` 且 `freshness.reason_code` 为确定性原因，如 `projection_revision_mismatch`）。

**可观测行为**: Gate 进入步骤 3a 非 fresh 分支，读取到 `mapperResult.freshness.reason_code` 为非空字符串。

**验证命令**:
```bash
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-diff | grep -q 'reason_code":"projection_revision_mismatch"'
# 期望：返回体已携带具体 reason_code（进入确定性分支）
```
**硬阈值**: 返回体含 `reason_code === "projection_revision_mismatch"`。

---

### Step 2: Gate 透传 reason_code + 对确定性结论走 fail-closed 出口
**来源**: `[FROM_PRD]` — Golden Path 第 2 条：不再折叠成通用 `reason:'mapper_stale' + retryable:true`，透传 `freshness.reason_code`，确定性结论 `retryable: false`（仍 `impact_unknown`/`blocked`，不假绿）。

**可观测行为**: 确定性 stale → `{gate:'impact_unknown', reason_code:'<code>', retryable:false}`；真瞬态（无 reason_code）→ 仍 `{reason:'mapper_stale', retryable:true}`（不被误 fail-closed）。structure gate 同源分支同处理策略（[语义一致] 铁律）。

**验证命令**:
```bash
# 确定性：retryable=false + reason_code 透传（diff + structure 两端）
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-diff | grep -q 'OK: det-diff'
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-structure | grep -q 'OK: det-structure'
# 真瞬态：retryable=true 保留刷新窗口（不误判 fail-closed）
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs transient-diff | grep -q 'OK: transient-diff'
```
**硬阈值**: 确定性两端 exit 0（retryable:false + reason_code 透传）；瞬态 exit 0（retryable:true）。

---

### Step 3: 确定性结论 → 回执/失败原因携带具体 reason_code，orchestrator 精确终止（不空转）
**来源**: `[FROM_PRD]` — Golden Path 第 3 条：orchestrator 因 `retryable === false` 归类为 `impact_contract_invalid`，run 以 `impact_gate_deterministic:<reason_code>` 精确终止；回执含具体 reason_code（不再通用 mapper_stale）。

**可观测行为（既有下游链路，本单不改）**:
- `loop.js:1543` `impactGateReceipt?.retryable === false ? 'impact_contract_invalid' : 'infrastructure_blocked'` —— retryable:false 命中 `impact_contract_invalid`。
- `loop.js:1663` `failRun(\`impact_gate_deterministic:${reason}\`)`，其中 `reason = fallback_reason = impactGateReceipt.reason`。
- `harness-gates.js:30` `gateReceipt.reason = result.reason ?? result.reason_code` —— **只有当 diff gate 不再输出通用 `reason:'mapper_stale'`（改出 `reason_code`）时**，回执 `reason` 才 fallback 到具体 `reason_code`，失败原因变为 `impact_gate_deterministic:projection_revision_mismatch`（非 `:mapper_stale`）。

**验证命令**:
```bash
# 复刻 gateReceipt 的 reason 规则：确定性分支不折叠 mapper_stale，具体 reason_code 得以显现
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs mask-diff | grep -q 'OK: mask-diff'
# 期望：result.reason !== 'mapper_stale' 且 (reason ?? reason_code) === 'projection_revision_mismatch'
```
**硬阈值**: mask-diff exit 0（回执侧 reason 显现具体 reason_code，不被通用 mapper_stale 遮蔽）。

> **下游归类不改动理由（ASSUMPTION 3 落定）**: `loop.js` retryable:false → `impact_contract_invalid` 的既有链路已正确，`gateReceipt.reason` 的 `?? reason_code` fallback 已存在。因此**最小改动**只需 diff-gate/structure-gate 停止对确定性结论输出通用 `reason:'mapper_stale'`、改出 `reason_code` + `retryable:false`；`loop.js`、`harness-gates.js` 不在本单改动文件内。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` → 现有断言：`没有 active contract 时 fail-closed，且不调用 Mapper`（reason `contract_missing` retryable:false）、`Mapper.radius() 超时时 Diff Gate 返回 blocked`（retryable:true）、`Mapper revision mismatch 时 Diff Gate 返回 blocked`（reason `revision_mismatch` retryable:true）、`同一 base revision 的 projection digest 漂移时刷新合同版本`（reason `manifest_digest_mismatch` retryable:true）—— 本单**不得回退**这些既有 reason/retryable。
- [回归] `packages/brain/src/impact-contract/__tests__/structure-gate.test.js` → 现有 `mapper_unavailable`(503)/`revision_mismatch`(409) retryable:true 分支不得回退。
- [累积FR] context-manifest: 本 journey e6f803f2 无 done/working ability，累积 FR 为空（PRD 已声明「本 line 暂无历史」）。
- [MAP] `[MAP_NOT_CONFIGURED]`（map_repo 缺失）→ 无 must_run_assertions 折入。

## 禁 mock 边清单

本单改动涉及**状态机（裁决 retryable/终态分流）** + **跨模块数据传递（Gate 返回体 reason_code → gateReceipt → loop.js 归类）**，failing test / oracle 必须真调被改的边：

- `代码 ↔ evaluateDiffGate 步骤 3a 分支`（本单改写该分支返回体）：测试/oracle 必须真调 `evaluateDiffGate` 本体，只注入更外层 `mapClient`（Mapper HTTP 边界，本单不改其算法），**禁止 vi.mock/stub `diff-gate.js` 自身**。
- `代码 ↔ evaluateStructureGate 规则 3 分支`（同源并修）：同上，真调 `evaluateStructureGate`，只注入 `mapClient`。
- `Gate 返回体 reason 字段 ↔ gateReceipt reason 规则`：mask-diff oracle 复刻 `result.reason ?? result.reason_code` 规则真跑真断言，不 mock 该 fallback 逻辑（loop.js/harness-gates 不改，故以复刻规则的真值断言守住语义一致）。

> 无 Postgres（runtime_resources.postgres=false）：`db:null` 使 `getActiveImpactContract` 被跳过、contract=null，步骤 3a stale 分支在纯进程内即可真实进入——不 mock DB，而是走 db:null 合法路径，被改的裁决边全程真跑。

## 真实调用方请求 shape

N/A —— 本单无设备/agent/webhook 等外部真实调用方；`evaluateDiffGate`/`evaluateStructureGate` 是 Brain 进程内被 orchestrator 直接调用的裁决函数，输入由 orchestrator 组装，Mapper 结果经依赖注入 `mapClient`。无跨认证路径分叉风险。

## 未覆盖真实链路清单

- **Mapper 真实 freshness.reason_code 生产取值**（force/inject）：本单 oracle 用注入 `mapClient` 构造 `freshness:{status:'stale',reason_code:'projection_revision_mismatch'}`，未真调生产 `/api/brain/map/radius` 取真实 reason_code。**理由**: PRD 范围限定明确「不在范围内：Mapper 自身 freshness/reason_code 的计算逻辑」；本单只验 Gate 对已给结论的透传+分流。**真验证补位计划**: Mapper 侧 reason_code 计算由其自有回归覆盖；本单端到端 orchestrator `impact_gate_deterministic:<code>` 精确终止的真机跑属 F1 evaluator 阶段真验（本 GAN 阶段只产出可执行 oracle 与合同）。
- **orchestrator loop.js failRun 端到端**（logic-done-pending）：Step 3 下游归类为既有未改链路，本合同以「复刻 gateReceipt reason 规则的真值断言（mask-diff）」+ 静态引用 loop.js:1543/1663 行为守住；不在无 Postgres 环境启整条 run。标 `logic-done-pending`：真实 run 精确终止效果需 F1 真验闭环观测。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | Diff/Structure Gate 对「确定性 stale 结论（含具体 reason_code）」透传 reason_code 并走 fail-closed 出口（retryable:false）；对真瞬态（无 reason_code）保留 retryable:true |
| **NFR（做得多好）** | 性能/可靠性 | 进程内同步裁决，无新增外呼；目标恰是消除无限重试空转（原空转至 run deadline 5400s）→ 确定性结论即时终止 |
| **Invariant（永不违反）** | 不变量 | [fail-closed] 确定性/瞬态两分支返回体均 blocked（impact_unknown/blocked），绝不假绿放行；[语义一致] diff/structure 两端对 mapper_stale/reason_code 同一处理策略 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效退役 | N/A —— 纯裁决逻辑，无 token/数据保质期 |
| **死亡告警（停了谁知道）** | 告警 | 确定性终止走 `failRun(impact_gate_deterministic:<code>)`，run 失败留痕带具体 reason_code，orchestrator/Brain 记录可见（不静默） |
| **失败语义（挂了怎么办）** | 故障策略 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | 回执 `gateReceipt.reason` fallback 到具体 reason_code；失败原因 `impact_gate_deterministic:<code>` 即生效回执；拿不到具体 code（仍 mapper_stale）= 未生效 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 一个 stale 结论是否「确定性」（重试不会改变） | A. 按 `freshness.status` 值（stale=确定/unknown=瞬态）; B. 按 `freshness.reason_code` 是否非空字符串 | B. `reason_code` 非空 ⟺ 确定性 | Map 已给出固定 reason_code 即表示已判定、重试不改变（PRD ASSUMPTION）；单纯 status 不足以区分（status='stale' 但 reason_code=null 时无法判定，保守归瞬态保留重试，避免误 fail-closed 卡死刷新窗口） | 误判确定性为瞬态 → 继续无限 backoff 空转（回归原 bug）；误判瞬态为确定性 → 正常刷新窗口被 fail-closed 卡死（PRD 边界情况明令禁止）。故以 reason_code 非空为唯一判据 |
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |

> `status='stale'` 且 `reason_code=null` 的歧义情形：按判据 B 归为**非确定性 → 保留 retryable:true**（保守：不确定就别 fail-closed，仍 blocked 不假绿）。此判据已在 GAN 阶段与 Mapper 契约（`freshness.reason_code` 为 Map 已给固定原因）核对锁定。⚠️ 该判定点误判后果为「run 空转」或「刷新窗口卡死」，属需留痕的关键判定；PrepPRD 已在 ASSUMPTION 中拍板判据边界，无需再升拍板。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper 抛错/不可达 | 返回 `mapper_unavailable` retryable:true（不进裁决） | 是（纯读，无副作用） | 既有 infra backoff 刷新（真不可达属瞬态） |
| 确定性 stale（reason_code 非空） | 返回 `reason_code` retryable:false，blocked 不放行 | 是（纯裁决，无写） | orchestrator 归类 impact_contract_invalid → 精确 failRun，不 backoff |
| 真瞬态 unknown（无 reason_code） | 返回 `mapper_stale` retryable:true，blocked | 是 | 既有 infra backoff 刷新窗口 |

### 输入对抗面

N/A —— 本单非对外暴露 agent；`evaluateDiffGate`/`evaluateStructureGate` 由 Brain orchestrator 进程内调用，输入非外部用户可写。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness.reason_code` 为空串 `""` / 数字 / 布尔（非字符串）→ 应归瞬态保留 retryable:true（判据要求「非空字符串」，空串/非字符串不算确定性），验证不会误 fail-closed
- 错输入: `freshness.status='fresh'` 但携带 `reason_code`（矛盾输入）→ 应正常进入 fresh 后续对账，不被 stale 分支拦截
- 重复提交: 同一确定性 stale 结论并发多 task 命中 → 各自独立返回 retryable:false，不共享/污染 backoff 计数（PRD 边界情况第 4 条）
- 中途中断: N/A（进程内同步无中断点）
- 边界值: `reason_code` 超长字符串 / 含特殊字符 → 应字面透传不截断不注入
发现分级: P0/P1（误 fail-closed 卡死刷新窗口 / 确定性仍空转 / 假绿放行）→ 阻塞 merge；P2/P3（reason_code 边界透传瑕疵）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，node -e 直调 + vitest，无 Postgres）

**journey_type**: autonomous
**target_environment**: local_api

> 本单为进程内裁决函数改动，无 HTTP 端点、无 DB 写（runtime_resources.postgres=false）。E2E 以 `node` 直调真实 Gate 函数（注入 mapClient、db:null 合法路径）+ 仓库真实 vitest 回归组成，全程真跑被改的裁决边。
> vitest 工作目录死规则：`packages/brain/src/**` 测试用子 shell 切进包根跑（该包自己的 vitest 配置）；`sprints/**` 合同测试从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

echo "▶ 1/3 sprint 合同回归（红→绿，从仓库根跑，命中根 vitest include sprints/**）"
npx vitest run sprints/08202126-kernel-a435f484/tests/diff-gate-deterministic-stale.test.js --reporter=dot

echo "▶ 2/3 brain 包内 diff-gate/structure-gate 既有回归不得退（子 shell 切包根，用包自己的 vitest 配置）"
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/structure-gate.test.js )

echo "▶ 3/3 可执行 oracle：确定性 fail-closed + reason_code 透传 + 瞬态保留（真调 Gate，db:null）"
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-diff          | grep -q 'OK: det-diff'
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs mask-diff         | grep -q 'OK: mask-diff'
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs det-structure     | grep -q 'OK: det-structure'
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs transient-diff    | grep -q 'OK: transient-diff'
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs transient-structure | grep -q 'OK: transient-structure'
node sprints/08202126-kernel-a435f484/tests/verify-gate.mjs unavail-diff      | grep -q 'OK: unavail-diff'

echo "✅ Golden Path 验证通过：确定性 stale 透传 reason_code + fail-closed，瞬态/不可达保留 retryable"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性 stale diff gate 透传 reason_code + fail-closed | `sprints/08202126-kernel-a435f484/tests/diff-gate-deterministic-stale.test.js` | `透传 reason_code 且 retryable false` | → `expected undefined to be 'projection_revision_mismatch'` |
| 确定性 stale diff gate 不折叠 mapper_stale | 同上 | `不再折叠成通用 mapper_stale reason 遮蔽回执` | → `expected 'mapper_stale' not to be 'mapper_stale'` |
| 真瞬态 unknown diff gate 保留 retryable | 同上 | `保留 retryable true 刷新窗口` | 基线绿（守活，不得回退） |
| Mapper 不可达保留 retryable | 同上 | `保持 mapper_unavailable retryable true` | 基线绿（守活） |
| 确定性 stale structure gate 透传 + fail-closed | 同上 | `structure gate 透传 reason_code 且 retryable false` | → `expected undefined to be 'projection_revision_mismatch'` |
| 真瞬态 structure gate 保留 retryable | 同上 | `structure gate 保留 mapper_stale retryable true` | 基线绿（守活） |
