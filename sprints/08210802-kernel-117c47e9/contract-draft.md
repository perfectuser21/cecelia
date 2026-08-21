# Sprint Contract Draft (Round 1)

sprint: 08210802-kernel-117c47e9
target: Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口（r34）
gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），按内置速查表写断言

## 锚定父路声明

独立小路（无父路）—— 本 sprint 是 `packages/brain/src/impact-contract/diff-gate.js` 内部
step 3a 判定逻辑修复，累积 FR 为空（本 line 暂无与 Diff Impact Gate 相关的已验收
golden_path），无既有父 Golden Path 覆盖。

## Unified Map 半径

`[MAP_NOT_CONFIGURED]` —— task.payload.map_scope=["F1"] 但 map_repo 缺失、expected_files 为空，
无法计算 radius；不回退领域硬编码，无 must_run_assertions 注入。已知回归约束仅取自本仓
既有测试（见「已知约束」）。

## Response Schema（推导来源: PRD 字面 + 代码基线 diff-gate.js 返回 shape）

### 被测对象: `evaluateDiffGate(...)` 返回对象（内部函数，无 HTTP 端点）

N/A — 任务无 HTTP 响应（纯 Brain 内部 impact-contract 判定逻辑）。观测契约 = 函数返回对象。

step 3a（非 fresh）分支返回体字段（本 sprint 唯一改动面）：
```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": "<boolean>"}
```
- `gate` (string, 必填): 恒为 `"impact_unknown"`（不可判定 → 不进入 pass/extend/drift）。来源——代码基线 header 契约不变。
- `reason` (string, 必填): 非 fresh 拒绝分类标记（保留，人读用）。来源——代码基线。
- `reason_code` (string|null, 必填): **本 sprint 核心**——透传 `mapperResult.freshness.reason_code`；无来源时为 `null`，禁止虚构。来源——PRD Golden Path 第 3 步。
- `retryable` (boolean, 必填): **本 sprint 核心**——确定性结论（freshness 带 reason_code）= `false`（fail-closed 终态）；无 reason_code 的暂时性 stale = `true`（保守，保留可恢复）。来源——PRD Golden Path 第 4/5 步 + 边界情况。

**禁用字段名**: 无（不新增字段，仅赋值 reason_code 与 retryable）。
**判定规则（proposer 锁定，唯一确定性依据 = freshness.reason_code 是否存在）**:
- `freshness` 存在且 `freshness.status !== 'fresh'` 且 `freshness.reason_code` 非空 → 确定性结论：`reason_code = freshness.reason_code`，`retryable = false`（含未知枚举值，默认 fail-closed）。
- `freshness` 缺失 / 为空 / 有 status 但无 `reason_code` → 保守：`reason_code = null`，`retryable = true`（避免误杀暂时抖动）。
- 说明：以 `reason_code` 主导（PRD 边界「由 reason_code 主导」），不以 `status` ∈ {stale,unknown} 区分 retryable——两者只要带 reason_code 即确定性。

## 回归测试位置说明（与 PRD 预期受影响文件的对账）

PRD「预期受影响文件」把回归断言指向 `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`，
仅为提示。本合同按 harness 原生模式把**复现空转的永久回归测试**落在
`sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js`——该路径由根
`vitest.config.js` 的 `sprints/**` include 收录，合并后在 CI「Sprint Tests」永久跑（满足 CLAUDE.md
硬规则 19/20「先写复现失败测试 + 永久保留在 CI」）。generator 唯一改动面是 `diff-gate.js` step 3a；
不强制向仓库 `__tests__/diff-gate.test.js` 复制断言（避免与 sprint 回归测试重复、避免弱 oracle：
该文件因既有 CONTRACT_IMPACT_DRIFT 断言已含 `reason_code` 字样，裸 grep 会假绿）。INV-1 仅要求该套件
**无回归**。

## 已知约束（来自回归测试）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「fail-closed：Mapper 异常时 Diff Gate 不假绿」（现有 fail-closed 套件，本 fix 不得破坏其 impact_unknown 语义）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 「没有 active contract 时 fail-closed，且不调用 Mapper」（contract_missing 分支 retryable:false 不变）
- [packages/brain/src/impact-contract/__tests__/map-client.test.js] → freshness `{status:'stale', reason_code:'projection_revision_mismatch'}` 为真实存在的 Mapper 输出形态（本 sprint 透传对象形态锚点）
- [累积FR] （本 line 暂无与 Diff Impact Gate 相关已验收 golden_path，context-manifest 无新增约束）

## 禁 mock 边清单

- `evaluateDiffGate` step 3a freshness 判定逻辑 ↔ 其返回的 `reason_code`/`retryable`：测试必须真调 `evaluateDiffGate`（禁止 stub/替身被测函数本身或其 freshness 分支），并喂入真实 `freshness` 对象让真逻辑跑出返回值。
- 允许注入 `mapClient`：Mapper（map-client.js）是本 sprint **明确 out-of-scope** 的外部边界，与既有 `diff-gate.test.js` 依赖注入约定一致；`db` 用 `null`（step 3a 在任何 DB 副作用之前返回，本 sprint 不触达状态机/DB 写路径）。
- 说明：本单是单函数内一个纯分支的返回值计算，不涉及跨模块数据传递/DB 写路径/生命周期钩子；被改的边即「freshness → verdict」纯逻辑，已由上面第一条覆盖真验。

## Golden Path

[编码后进入 Diff Impact Gate] → [Mapper 复算返回确定性非 fresh 结论] → [透传 reason_code 且 fail-closed 终结，不空转]

### Step 1: Mapper 返回确定性 stale（带 reason_code）→ gate 透传 reason_code
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2、3 步

**可观测行为**: `evaluateDiffGate` 在 mapClient 返回 `freshness.status='stale'` 且带 `reason_code='projection_revision_mismatch'` 时，返回体 `reason_code` 字段等于该值（不再写死 `mapper_stale` 掩盖来源）。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js -t '透传 reason_code'
# 期望：该用例通过，result.reason_code === 'projection_revision_mismatch'
```
**硬阈值**: 用例 PASS（exit 0）；`reason_code` 严格等于 Mapper 传入值。

---

### Step 2: 确定性结论 → fail-closed 终态出口（retryable:false）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 边界「reason_code 为未知枚举值：默认 fail-closed 终态」

**可观测行为**: 确定性 stale/unknown（带 reason_code，含未知枚举）返回 `retryable:false`，任务进入终态，派发层不再无限重试。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js -t 'fail-closed'
# 期望：确定性用例 retryable:false
```
**硬阈值**: 确定性用例 `retryable===false`；`gate==='impact_unknown'` 不变。

---

### Step 3: 暂时性 stale（无 reason_code）保护 → retryable:true 不误杀
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步 + 边界「freshness 缺失/为空 → 保守 retryable:true」

**可观测行为**: `freshness.status='stale'` 但无 `reason_code` 时，返回 `retryable:true`、`reason_code:null`（保留暂时抖动可恢复路径，且不虚构来源）。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js -t '未被误杀'
# 期望：无 reason_code 用例 retryable:true 且 reason_code 为 null
```
**硬阈值**: `retryable===true` 且 `(reason_code ?? null)===null`。

---

### Step 4: 出口 — fail-closed 铁律不破（Mapper 不可判定绝不假绿）
**来源**: `[FROM_PRD]` — PRD Invariant「[不假绿] Mapper 任何不可判定情形均 fail-closed，绝不假绿放行」

**可观测行为**: 非 fresh 分支任何情况下 `gate` 恒为 `impact_unknown`，绝不返回 `pass`/`extend`；既有 fail-closed 套件全绿。

**验证命令**:
```bash
(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js)
# 期望：既有 fail-closed 套件 + 新增永久回归断言全绿
```
**硬阈值**: 仓库 diff-gate.test.js 全部 PASS（含 generator 新增的永久回归断言）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 系统对外承诺做什么 | diff-gate step 3a 非 fresh 分支透传 `freshness.reason_code`，并按「是否带 reason_code」给出确定性(false)/保守(true) 的 retryable |
| **NFR（做得多好）** | 性能/可靠性/并发阈值 | 确定性结论必须终态收敛，不得触发无限重试空转（本 sprint 核心约束）；纯同步分支，无性能面 |
| **Invariant（永不违反）** | 任何情况下不得打破 | [不假绿] 非 fresh 分支 gate 恒 impact_unknown，绝不假绿放行为 pass/extend |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | N/A — 纯判定逻辑，无 token/缓存/数据保质期 |
| **死亡告警（停了谁知道）** | 停止工作谁多久知道 | gap ledger / runs 可观测 `reason_code`；空转消失后 `deny:impact:mapper_stale` 不再刷屏即为健康信号 |
| **失败语义（挂了怎么办）** | 故障放行还是拦截 | 见下方失败语义声明——一律拦截（fail-closed），确定性终态、无 reason_code 保守可重试 |
| **效果确认（已发≠已生效）** | 如何确认真实生效 | 返回对象即效果本体，vitest 断言 reason_code 透传值与 retryable 布尔即回执 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| 某非 fresh 结论是「确定性(不可重试)」还是「暂时性(可重试)」 | A. 按 status ∈ {stale,unknown} 区分; B. 按 `freshness.reason_code` 是否存在区分 | B. 按 `freshness.reason_code` 是否存在 | PRD 边界「由 reason_code 主导」；status 不足以区分抖动 vs 确定失效，reason_code 是 Mapper 显式给出的确定性信号 | 误判为确定性→误杀可恢复任务(终态 blocked 需人重开)；误判为暂时→无限重试空转(本 bug) |

（本任务无真机/RPA 接缝判定点，唯一判定点为上表 reason_code 主导规则，属服务端逻辑判定。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 确定性非 fresh（带 reason_code，含未知枚举） | 返回 impact_unknown + retryable:false，任务终态收敛 | N/A（终态，不重试） | 无——fail-closed 即终态，人可依 reason_code 排查 |
| 暂时性 stale（无 reason_code） | 返回 impact_unknown + retryable:true | 是（判定为纯函数，同输入同输出） | 派发层可重试；连续达 max_retries 由派发层 dispatch-fail-autoblock 兜底终态（out-of-scope，见未覆盖清单） |
| freshness 缺失/为空对象 | 同「无 reason_code」保守 retryable:true，reason_code:null | 是 | 同上 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 为 Brain 内部 impact-contract 判定逻辑，无对外暴露 agent / 用户可写入接口。

## 真实调用方请求 shape

N/A — 无设备/agent 调服务端；被测对象是 Brain 内部纯函数 `evaluateDiffGate`，Mapper 结果经既有依赖注入口 `mapClient` 传入。

## 未覆盖真实链路清单

- 真实 Mapper HTTP 链路（`map-client.js` 的 `queryImpactRadius` → POST /api/brain/map/radius）｜本 sprint 范围明确排除 Mapper 自身 freshness/reason_code 产出逻辑，diff-gate 测试通过注入 `mapClient` 喂入确定性 freshness 对象｜真验证补位：map-client.js 有独立回归测试（`__tests__/map-client.test.js` 已覆盖 `{status:'stale', reason_code:'projection_revision_mismatch'}` 真实输出形态），本 sprint 不重复。
- 派发层 `max_retries` 终态收敛（PRD 边界情况第 4 条）｜属 dispatcher 语义（dispatch-fail-autoblock），本 sprint 范围限定 diff-gate.js step 3a，不触达派发层｜真验证补位：由既有 dispatch-fail-autoblock 语义保证，本 sprint 不改动。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 改动为 Brain 内部纯判定逻辑，无 DB 副作用、无 HTTP 端点（step 3a 在任何 DB 写路径前返回）。
> 因此 local_api 验收以 vitest 依赖注入真跑 `evaluateDiffGate` 为准（runtime postgres 不可用亦不需要）。
> sprints/** 测试从仓库根跑；packages/brain/src/** 测试用子 shell 切进包根（vitest 工作目录死规则）。

```bash
#!/bin/bash
set -euo pipefail

# 1. Sprint 契约回归测试（复现 + 修后全绿）——sprints/** 从仓库根跑，命中根 vitest include
npx vitest run --no-cache sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js 2>&1 | tee /tmp/sprint-e2e.log
grep -Eq "3 passed|Tests[[:space:]]+3 passed" /tmp/sprint-e2e.log || { echo "FAIL: sprint 契约测试未全绿(需 3 passed)"; exit 1; }

# 2. 仓库既有 diff-gate 套件必须无回归（fail-closed 铁律 + revision/digest 分支语义不被本 fix 波及）
#    packages/brain/src/** 用子 shell 切进包根（vitest 工作目录死规则）
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ) 2>&1 | tee /tmp/repo-e2e.log
grep -Eq "passed" /tmp/repo-e2e.log || { echo "FAIL: 仓库 diff-gate 套件未通过"; exit 1; }
grep -Eq "[1-9][0-9]* failed" /tmp/repo-e2e.log && { echo "FAIL: 仓库 diff-gate 套件存在 failed（本 fix 引入回归）"; exit 1; } || true

echo "✅ Golden Path 验证通过：reason_code 透传 + 确定性 fail-closed 终态收敛"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `freshness` 为 `null` / `{}` / `{status:'stale', reason_code:null}` / `{status:'stale', reason_code:''}`（空串是否被当无 reason_code）——确认保守 retryable:true 且 reason_code:null，不抛异常。
- 边界值: `freshness.status='fresh'` 但携带 `reason_code`（正常 fresh 路径不应进 3a，reason_code 不应误透传成拒绝）。
- 回归面: 触发既有 revision_mismatch / manifest_digest_mismatch 分支（step 3b/3c），确认 retryable 语义未被本 fix 波及（仍 retryable:true）。
- 中途中断: 同一输入多次调用返回一致（纯函数幂等，无隐藏状态）。
发现分级: P0/P1（fail-closed 铁律被破/暂时性 stale 被误杀终态）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
