# Sprint Contract Draft (Round 1)

**Sprint**: Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 [r42]
**journey_type**: autonomous
**target_environment**: local_api
**base_sha（冻结实现基线）**: 33392def38a2e360d1a27dc8381759f811869000（不可变）

> Kernel validation identity 说明：本合同不写死任何 attempt/account/capability_snapshot 字面值；
> E2E 与 DoD 均为纯内部裁决逻辑单测，不注入 role 身份。run_id/repo/base_sha 为运行前冻结对象，可按 PRD 固定。

contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），走代码层 Contract Gate；断言按合规惯用法速查表书写。
gp-anchor: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 明确 + diff-gate.js 现有返回契约）

### 内部函数: `evaluateDiffGate(...)` 步骤 3a 非 fresh 出口返回对象

本 sprint 无 HTTP 端点（纯 Brain 内部裁决逻辑）。裁决结果对象即验收 oracle：

```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": <boolean>}
```

- `gate` (string, 必填): 固定 `"impact_unknown"`（3a 非 fresh 出口不变）— 来源：PRD Golden Path Step 1 + diff-gate.js 现契约
- `reason_code` (string|null, 必填): 透传 `mapperResult.freshness.reason_code`；freshness 缺失或无该字段 → `null` — 来源：PRD Step 2 明确
- `retryable` (boolean, 必填): 瞬时白名单码或 `null` → `true`；其余确定性码 → `false`（fail-closed）— 来源：PRD Step 2 明确
- `reason` (string, 必填): 归因标签。确定性/瞬时码存在时 = 该具体 `reason_code`；`reason_code == null`（纯瞬时兜底）时才回落 `"mapper_stale"` — 来源：PRD Step 3「deny 标签 = 具体 reason_code，不再裸 mapper_stale」

### 内部函数: `gateReceipt('diff', result, ...)` 回执对象（harness-gates.js）

```json
{"stage": "diff", "gate": "<string>", "reason": "<string|null>", "reason_code": "<string|null>", "retryable": <boolean>}
```

- `reason_code` (string|null, 必填): 新增字段，透传 `result.reason_code`；deny 标签归因源 — 来源：PRD 范围「gateReceipt 确保 deny 标签用具体 reason_code」
- `reason` (string|null): 保持 `result.reason ?? result.reason_code ?? null`（现逻辑），确定性码场景不再裸 `mapper_stale`

**禁用字段名**: 不得把确定性 reason_code 折叠成裸 `mapper_stale`（除 `reason_code == null` 的纯瞬时兜底）。

**瞬时白名单（固定，来源 PRD/task 冻结）**: `fact_snapshot_stale`、`projection_revision_missing`、`null`。其余一律确定性 → `retryable: false`。

**Error（非法输入）**: N/A — 纯内部裁决函数，无 HTTP error path；边界情况（freshness 缺失/未知码）见下方 Golden Path 边界处理。

---

## Golden Path

独立小路（无父路）— 本 sprint 是 Diff Impact Gate 内部裁决归因修复，journey_id `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`，本 line 暂无历史 GP。

[Mapper 返回非 fresh freshness] → [reason_code 读取 + 确定性/瞬时分流] → [带归因的 gate 裁决 + gateReceipt deny 标签]

---

### Step 1: `evaluateDiffGate` 步骤 3a 检测到 freshness 非 fresh，读取并透传 reason_code
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 步直接定义

**可观测行为**: 当 `mapperResult.freshness.status !== 'fresh'`（或 freshness 缺失），gate 结果对象的 `reason_code` 字段 = `mapperResult.freshness.reason_code`（缺失则 `null`），不再固定丢弃。

**验证命令**:
```bash
cd "$(git rev-parse --show-toplevel)"
npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-01" --no-cache
# 期望：exit 0（确定性码 no_anchor 被透传进 reason_code）
```

**硬阈值**: `result.reason_code === 'no_anchor'`（透传成功）；验证命令：`npx vitest run ... -t "B-01"` exit 0

---

### Step 2: 确定性码 fail-closed / 瞬时白名单保留 retryable
**来源**: `[FROM_PRD]` — PRD Step 2 分流规则 + NFR「确定性 reason_code 必须 retryable:false」

**可观测行为**:
- 确定性码（`no_anchor` / `revision_mismatch` / `fail_current_revision` / `resolver_error` / 任意白名单外未知码）→ `retryable: false`
- 瞬时白名单（`fact_snapshot_stale` / `projection_revision_missing`）或 `null`（含 freshness 缺失）→ `retryable: true`

**验证命令**:
```bash
cd "$(git rev-parse --show-toplevel)"
npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-02" --no-cache
npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-03" --no-cache
npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-05" --no-cache
# 期望：三条均 exit 0（瞬时→true、null→true、未知→false）
```

**硬阈值**: 瞬时/null `retryable === true`；确定性/未知 `retryable === false`。命令：上述三条 `-t` vitest exit 0

---

### Step 3: gateReceipt deny 标签透传具体 reason_code，不再裸 mapper_stale
**来源**: `[FROM_PRD]` — PRD Step 3 + 范围「harness-gates.js gateReceipt 确保 deny 标签透传具体 reason_code」

**可观测行为**: 对确定性 diff gate 结果，`gateReceipt('diff', result)` 回执的 `reason_code` = 具体码，`reason` = 具体码（非裸 `mapper_stale`）。

**验证命令**:
```bash
cd "$(git rev-parse --show-toplevel)"
npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-04" --no-cache
# 期望：exit 0（receipt.reason_code === 'no_anchor' 且 receipt.reason !== 'mapper_stale'）
```

**硬阈值**: `receipt.reason_code === 'no_anchor'` 且 `receipt.reason === 'no_anchor'`。命令：`npx vitest run ... -t "B-04"` exit 0

---

### Step 4（出口）: 整套回归全绿，failing test 永久留 CI
**来源**: `[AI_ADDED]` — 理由：CLAUDE.md 硬规则 19/20「修 bug 先写复现 failing test，修复后永久留 CI 作回归」；本步确保 red→green 收敛且回归覆盖闭合，防止 mapper_stale 无限重试空转复发。

**可观测行为**: 整个 sprint 冻结测试文件全绿（5 类分流场景 + gateReceipt 透传）。

**验证命令**:
```bash
cd "$(git rev-parse --show-toplevel)"
npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts --no-cache --reporter=verbose
# 期望：全部 pass，exit 0
```

**硬阈值**: 测试套件 exit 0，无 fail。命令：整文件 `npx vitest run` exit 0

---

## 禁 mock 边清单

本单改动涉及 **状态机 / 跨模块数据传递**（Diff Impact Gate 裁决分支 + gate 结果跨模块传给 gateReceipt），failing test 必须真跑被改的边：

- `evaluateDiffGate` ↔ `mapperResult.freshness.reason_code`（本单在 3a 出口读取并分流该字段）→ 测试必须真实调用 `evaluateDiffGate`（不 mock 该函数），用注入的 `mapClient` 返回真实 freshness shape 驱动分支；只 mock 更外层的 Mapper HTTP（`mapClient`）与 Postgres（`db.query`）边界。
- `gateReceipt`（harness-gates.js）↔ diff gate 结果对象（本单让 gateReceipt 透传 `reason_code`）→ 测试必须经真实 `createHarnessImpactGates(...).beforeEvaluate(...)` 走真实 `gateReceipt`（不 mock gateReceipt），仅把 `diffGate` 作为**输入边界**注入受控 `reason_code` 结果；`gateReceipt` 对该结果的透传转换全程真实执行。

允许 mock 的外层无关边界：`mapClient`（Mapper HTTP）、`db`（Postgres，本 run postgres=false）、`getActiveContract`、`readChangedFiles`、`diffGate`（仅作为 gateReceipt 的上游输入边界；其真实 reason_code 生产由 B-01/B-02/B-03/B-05 直接覆盖真实 `evaluateDiffGate`，两端接缝端到端闭合）。

> 说明：本单非 DB 写路径改动，被改的两条边均为**纯内存决策/数据透传**，故 db 作为外层边界 mock 合规（db 非被改的边）。

---

## 已知约束（来自回归测试 + 累积 FR）

- [diff-gate.test.js] → fail-closed：Mapper 异常时 Diff Gate 不假绿（Mapper 抛异常 → impact_unknown，retryable=true）
- [diff-gate.test.js] → Mapper revision mismatch 时 Diff Gate 返回 impact_unknown / revision_mismatch / retryable=true（3b 出口，本 sprint 不改）
- [diff-gate.test.js] → fact_revisions 缺少目标 repo 时返回 impact_unknown（revision_evidence_missing，本 sprint 不改）
- [harness-gates.test.js] → merge 前重查 Mapper freshness，stale 时即使旧 Diff receipt 存在也阻断（该测试 mock diffGate 返回值，不受本 sprint 3a 改动影响）
- [累积FR] context-manifest: unavailable（postgres=false 本地无 Brain，端点不可达；本 line 现有 ability 均 planned，无 done/working 行为可回退）
- [MAP_NOT_CONFIGURED]：本 run 无 map_scope/map_repo 注入（postgres=false），Unified Map radius 未查询，不回退领域硬编码

## 铁律映射（Invariant）

- [fail-closed] Mapper 任何不可判定情形均返回 blocked/impact_unknown，绝不假绿 → 本 sprint **强化**该铁律：确定性不可判定码从「伪瞬时无限重试」改为 fail-closed（retryable=false）停机，语义更贴近 fail-closed；3a 仍返回 impact_unknown 不假绿。INV 覆盖见 DoD。
- [已有PR时钟] validation_clock_required → N/A：本 sprint 不触及 validation clock 建钟逻辑
- [基础设施重试身份] → N/A：本 sprint 不触及 Generator 基础设施重试路由
- [Planner分支] → N/A：本 sprint 不触及 Planner workspace checkout
- [Brain URL 权威] → N/A：本 sprint 不触及 Dispatcher/Fleet HARNESS_BRAIN_URL 注入

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺 | 3a 非 fresh 出口透传 `freshness.reason_code`；确定性码 fail-closed（retryable=false），瞬时白名单/null 保留 retryable=true；gateReceipt 透传 reason_code 使 deny 标签可归因 |
| **NFR（做得多好）** | 性能/可靠性 | 确定性码必须 retryable=false，杜绝无限重试空转（核心 NFR）；无新增延迟（纯内存分支判断） |
| **Invariant（永不违反）** | 不变量 | fail-closed：3a 仍返回 impact_unknown，绝不因分流改动而假绿放行；瞬时白名单固定二码+null，不得随意扩容 |
| **判定点（怎么知道）** | 判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 何时失效 | 瞬时白名单二码为 Mapper freshness 契约常量；若 Mapper 新增瞬时码需同步扩容白名单（跨 sprint，本单不含） |
| **死亡告警（停了谁知道）** | 告警 | 确定性码 fail-closed 后 run 停机并带具体 reason_code，Commander/Monitor 依 reason_code 归因；不再表现为「空转到超时」的沉默失败 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | gateReceipt.reason_code 即效果回执；确定性码走 fail-closed 出口而非重试，可由 receipt 字段机检确认 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| reason_code 是确定性还是瞬时 | A. 白名单枚举瞬时码，其余确定性; B. 白名单枚举确定性码，其余瞬时 | A. 白名单二码(`fact_snapshot_stale`/`projection_revision_missing`)+null 为瞬时，其余确定性 | PRD/task 冻结约定；宁停勿空转（未知码默认 fail-closed 更安全） | 确定性码误判为瞬时 → 无限重试空转（本 bug）；瞬时码误判为确定性 → fail-closed 误停可恢复 run（白名单显式覆盖两瞬时码规避） |

> 本判定点由 PRD/task 显式冻结（瞬时白名单固定二码+null），非待拍板项，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写库 | 是 | 客户端重试 |
| Mapper freshness 非 fresh 且为确定性码 | gate=impact_unknown, retryable=false（fail-closed 停机） | N/A（不重试） | Commander 依具体 reason_code 归因处理，不空转 |
| Mapper freshness 非 fresh 且为瞬时白名单码/null | gate=impact_unknown, retryable=true | 是（幂等：重查 Mapper 无副作用） | 保留重试等待瞬时状态恢复 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 为 Brain 内部裁决逻辑，输入来自受信 Mapper 内部投影结果，非对外暴露 agent 接口。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 gate 为纯内部裁决逻辑（无 HTTP 端点、无外部 env）。评审 oracle 用注入的 `mapClient`/`db` 外层边界真实驱动
> `evaluateDiffGate` 与 `gateReceipt` 决策路径——被改的两条边（reason_code 分流、receipt 透传）全程真实执行，
> 无需 Postgres（本 run postgres=false）或运行中的 Brain。以下单块 bash 从仓库根跑 sprints/** 冻结测试。

```bash
#!/bin/bash
set -euo pipefail
# Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 —— 端到端验收
SPRINT_DIR="sprints/08220415-kernel-99e5425b"
cd "$(git rev-parse --show-toplevel)"

# Golden Path Step 1-4：三分流（确定性 fail-closed / 瞬时 retryable / null retryable）
# + gateReceipt deny 标签透传，一次性跑冻结回归套件（sprints/** 归根 vitest include）
npx vitest run "${SPRINT_DIR}/tests/diff-gate-reason-code.test.ts" --no-cache --reporter=verbose

echo "OK: Diff Impact Gate reason_code 三分流 + gateReceipt 透传全绿"
```

**通过标准**: 脚本 exit 0（冻结测试套件全绿）
**失败标准**: 任一分流断言 FAIL 或 gateReceipt 仍裸 mapper_stale → exit 非 0

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `mapperResult.freshness` 为 `{}`（无 status 无 reason_code）→ 应走非 fresh 分支、reason_code=null、retryable=true
- 错输入: `freshness.reason_code` 为空字符串 `""` → 空串非 null 且不在白名单 → 应归确定性 retryable=false（确认代码用 `?? null` 而非 falsy 判断，空串不被当 null）
- 边界值: `freshness.status === 'fresh'` 但带 reason_code → 不进 3a，进 3b 既有对账，行为不变（回归不破）
- 重复提交: 同一 mapperResult 连续两次 evaluateDiffGate → 纯函数式分流，结果幂等一致
发现分级: P0/P1（确定性码仍 retryable=true 空转 / fail-closed 误绿放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性码 fail-closed | `sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts` | B-01, B-05 | 现 3a 无 reason_code 字段且 retryable=true → 2 failures |
| 瞬时/null 保留 retryable | `sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts` | B-02, B-03 | 现 3a 无 reason_code 透传 → 2 failures |
| gateReceipt 透传 | `sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts` | B-04 | 现 gateReceipt 无 reason_code 字段 + 裸 mapper_stale → 1 failure |
| 回归（既有 diff-gate 契约不破） | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | fresh/revision_mismatch 路径不变（补充行，非冻结产物） | 现绿，改后仍绿 |
