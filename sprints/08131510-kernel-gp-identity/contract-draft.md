# Sprint Contract Draft (Round 1)

**锚定父路声明**: 独立小路（无父路）—— journey e6f803f2 下 ability 均为 planned 态，本 sprint 是修复 Kernel 组包判定的独立小路。

gp-anchor: skipped (product-map.json not found)
contract-gate: present (cecelia worktree, 代码层 Contract Gate 生效)

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 只改 `packages/brain/src/orchestrator/dispatcher.js` 内部纯同步函数 `gpContractIdentity` 的触发判定，无新增/变更 HTTP 端点。验收 oracle 为 node 直调真实 `createDispatcher` 组包路径 + brain vitest 永久回归，非 curl。

## 已知约束

### 来自回归测试
- [dispatcher.test.js:135] `把冻结 GP Contract 身份结构化注入下游 TaskBundle` → 完整六字段 GP 身份必须原样透传进 `bundle.inputs.gp_contract`（本 sprint 不得回退此断言，complete-gp 用例沿用其期望值）。

### 来自累积 FR
- context-manifest: 本 line（journey e6f803f2）下 ability 均为 planned 态，无已验收历史行为需保护。

### 来自 Unified Map（scope=cecelia, repo=perfectuser21/cecelia）
- must_run_assertions: []（task.payload.expected_files 为空，radius 为空，无额外必跑断言）

## Golden Path

[Kernel 派发 spawn:generator-fix（仅 journey_id）] → [dispatcher 组包判定 GP 合同身份] → [识别无 GP 触发字段，gpContractIdentity 返回 null] → [TaskBundle 成功产出，不注入 gp_contract，不 assembly fault]

---

### Step 1: Kernel 为「仅有 journey_id、无任何 GP 合同身份字段」的任务派发 spawn:generator-fix
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「触发条件」+ 背景（task ad9f3a01 仅带 journey_id，hop17 派 generator-fix）。

**可观测行为**: dispatcher 收到 payload 仅含 `journey_id`（通用 F1 锚点），无 `gp_contract_id/gp_contract_version/gp_contract_hash/golden_path_id/step_id` 任一字段。

**验证命令**:
```bash
node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs journey-only
# 期望：exit 0，stdout "OK: journey-only 组包成功、无 gp_contract、无 assembly fault"
```

**硬阈值**: exit 0；`bundle.inputs.gp_contract === undefined`；`res.failure_class !== 'assembly_fault'`。

---

### Step 2: dispatcher 识别无 GP 合同身份触发字段，gpContractIdentity 返回 null，不注入 gp_contract
**来源**: `[FROM_PRD]` — Golden Path 第 2 步「系统处理」+ 假设（触发字段集 = `{gp_contract_id, gp_contract_version, gp_contract_hash, golden_path_id, step_id}`，`journey_id` 不属触发字段）。

**可观测行为**: 判定触发集全空 → 提前 `return null`，`buildInputs` 不设 `common.gp_contract`，组包继续到 `createAttempt`。修复方向（What）：从「任一 `values` 字段（含 journey_id）非空即进入全字段校验」改为「仅当任一 GP 合同身份触发字段非空时才进入全字段校验」；`journey_id` 从触发判定剥离，但在全字段校验里仍需齐全合法（完整身份的必要组成，铁律不变）。

**验证命令**:
```bash
node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs empty
# 期望：exit 0（触发集全空 → return null，空态行为不变）
node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs journey-illegal
# 期望：exit 0（仅 journey_id 且非法格式，仍旁路 GP 全字段校验）
```

**硬阈值**: 两条均 exit 0；`bundle.inputs.gp_contract === undefined`。

---

### Step 3: TaskBundle 成功产出，不返回 TASK_BUNDLE_ASSEMBLY_FAILED，generator-fix 得以继续
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「可观测结果」。

**可观测行为**: 真实 spawn:generator-fix 组包路径产出 TaskBundle（`createAttempt` 被调用），返回对象 `failure_class !== 'assembly_fault'` 且 `fallback_reason !== 'TASK_BUNDLE_ASSEMBLY_FAILED'`。

**验证命令**:
```bash
node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs journey-only
# 期望：exit 0；createAttempt 被调用（probe 内部断言 bundle 非 null）
```

**硬阈值**: exit 0；组包不 assembly fault。

---

### Step 4: 部分 GP 身份 → 继续 fail-closed（保持既有保护）
**来源**: `[AI_ADDED]` — PRD「补充分支行为·部分 GP 身份」+ Invariant 铁律。理由：防止 generator 把「剥离 journey_id 触发」错误地扩大成「整体放宽 GP 校验」，用反向断言锁死 fail-closed 边界。

**可观测行为**: payload 出现任一 GP 触发字段（如仅 `golden_path_id`）但六字段不全 → 抛 `GP_CONTRACT_IDENTITY_INVALID` → `failure_class='assembly_fault'`，`createAttempt` 不被调用。

**验证命令**:
```bash
node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs partial-gp
# 期望：exit 0，stdout "OK: partial-gp 继续 fail-closed（GP_CONTRACT_IDENTITY_INVALID）"
```

**硬阈值**: exit 0；`res.failure_class === 'assembly_fault'` 且 `res.detail === 'GP_CONTRACT_IDENTITY_INVALID'`。

---

### Step 5: 完整 GP 身份 → gp_contract 结构化透传（保持既有行为不变）
**来源**: `[FROM_PRD]` — PRD「补充分支行为·完整 GP 身份」+ 已知约束 dispatcher.test.js:135。

**可观测行为**: 六字段（id/version/hash/golden_path_id/journey_id/step_id）齐全合法 → `bundle.inputs.gp_contract` 深等于既有期望对象。

**验证命令**:
```bash
node sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs complete-gp
# 期望：exit 0，gp_contract 六字段深等于既有期望
```

**硬阈值**: exit 0；`bundle.inputs.gp_contract` 深等于 `{id,version,hash,golden_path_id,journey_id,step_id}`。

---

## 禁 mock 边清单

本单改动属「跨模块数据传递 / 组包判定（Kernel dispatcher assembly 数据路径）」，触发禁 mock 规则。

- 代码 ↔ `dispatcher.gpContractIdentity` 判定边（本单改的正是该判定逻辑）：回归测试必须真调 `createDispatcher → buildBundle → buildInputs → gpContractIdentity`，**禁止** `vi.mock`/stub `gpContractIdentity`、`buildBundle` 或 `buildInputs`。只允许替身更外层无关 I/O 边界（`attemptStore`、`launcher`、`registry`、`loadSkill`）。
- 代码 ↔ TaskBundle 组包产物边：断言对象是真实 `createAttempt` 收到的 `input.bundle`（真实组包产物），不是脚本自造对象。
- 说明（postgres=false）：本单为纯同步组包判定，**不触达任何 DB 写路径**，故无「代码 ↔ DB 表」禁 mock 边；无需真 Postgres，brain-integration job 不涉及。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 仅 journey_id 的 generator-fix/evaluator 组包成功、不注入 gp_contract、不 assembly fault；任一 GP 触发字段出现时六字段必须完整合法否则 fail-closed；完整身份原样透传。 |
| **NFR（做得多好）** | 非功能 | 同步纯函数判定，无外部 IO；PrepPRD 未指定时延/频控阈值 → N/A（待定）。 |
| **Invariant（永不违反）** | 不变量 | ①部分 GP → fail-closed（`GP_CONTRACT_IDENTITY_INVALID`）；②默认 fail-closed 不整体放宽，只豁免「纯 journey_id」精确情形。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 失效 | 判定逻辑为长期契约，随 GP 合同身份字段集演进；本次触发字段集固定为 5 字段（不含 journey_id）。 |
| **死亡告警（停了谁知道）** | 告警 | 组包失败即返回精确 `failure_class=assembly_fault` + `fallback_reason`，Kernel run 账本可见 hop 终止；回归测试进 brain-ci，回退即 CI 红。 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执 | 组包产物 = 真实 `createAttempt` 收到的 `bundle`；probe 断言 `bundle.inputs.gp_contract` 与 `res.failure_class`，非 HTTP 200 空断言。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ payload 是否构成「GP 合同身份出现」 | A. 任一 `values` 字段（含 journey_id）非空即触发；B. 仅当任一 GP 合同身份触发字段（`{gp_contract_id, gp_contract_version, gp_contract_hash, golden_path_id, step_id}`，不含 journey_id）非空才触发 | B | journey_id 是通用 F1 锚点，几乎所有 F1 任务都带；A 会把 journey-only 误判为部分 GP 身份 → 全字段校验缺字段 → 假死 | 误判 A：journey-only 组包假死（生产 run 61b34e3b 已实证）；若反向过宽：部分 GP 身份漏过 fail-closed，放宽默认保护 |

> ⚠️ 该判定点误判后果严重（阻塞 F1 开发闭环 / 或放宽 fail-closed 保护），属「升拍板点」级别。PrepPRD 假设段已显式拍定触发字段集（[ASSUMPTION] 段），notes 标注：`judgment-pending-user: none（PrepPRD 假设段已拍定触发字段集，无需再确认）`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 部分 GP 身份（触发字段出现但不全/非法） | 抛 `GP_CONTRACT_IDENTITY_INVALID`，`preAttemptAssemblyFault` 返回 `failure_class=assembly_fault`，不建 attempt | 是（纯同步判定，同输入同结果） | fail-closed，不放行，Kernel 据 assembly_fault 终止/上报 |
| 触发集全空（含纯 journey_id / 空 payload） | 返回 null，不注入 gp_contract，正常组包 | 是 | 正常放行（不做版本化 GP 校验） |

### 输入对抗面

N/A —— dispatcher 组包不是对外暴露 agent；payload 来自 Kernel 内部可信派发路径，非外部用户可写入接口，无 Prompt Injection / 越权面。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 为纯 Brain 后端 dispatcher 组包判定，无 HTTP 端点、无 DB 写、postgres=false。final-e2e 直调真实 `createDispatcher` 组包路径（真实 `gpContractIdentity` / `buildBundle`，仅替身外层 I/O），按 Golden Path 五场景逐条 exit-code 断言。全部命令幂等、同步、可复跑。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
PROBE="sprints/08131510-kernel-gp-identity/tests/gp-identity-assembly.mjs"

# 核心修复：journey-only generator-fix 组包成功、无 gp_contract、不 assembly fault（生产复现路径）
node "$PROBE" journey-only

# 边界：仅 journey_id 且格式非法 → 仍旁路 GP 全字段校验
node "$PROBE" journey-illegal

# 铁律：部分 GP 身份 → 继续 fail-closed（GP_CONTRACT_IDENTITY_INVALID）
node "$PROBE" partial-gp

# 完整 GP 身份 → 六字段结构化透传不变
node "$PROBE" complete-gp

# 空态：无 journey_id 无 GP 字段 → return null，组包成功
node "$PROBE" empty

# 永久回归入 brain-ci：generator 须把上述断言移植进 packages/brain 的 __tests__，随 brain vitest 常驻
( cd packages/brain && NODE_OPTIONS="--max-old-space-size=3072" npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t "journey-only" 2>&1 | tee /tmp/gp-reg.txt; grep -Eq "Tests +[0-9]+ passed" /tmp/gp-reg.txt && ! grep -Eq "Tests.*[0-9]+ failed" /tmp/gp-reg.txt )

echo "✅ Golden Path 验证通过（journey-only 不再 assembly fault，部分 GP 仍 fail-closed，完整 GP 透传不变）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本单为纯同步组包判定，风险面窄）
高风险面:
- 错输入: `golden_path_id` 从 `payload.anchor.gp_id` 与 payload 顶层双路径取值，构造 `payload.golden_path_id` 与 `anchor.gp_id` 不一致（触发 `anchor.gp_id === values.golden_path_id` 断言分支）——确认仍 fail-closed 不误放行。
- 边界值: `gp_contract_version` 传 `0`/负数/字符串 `"1"`/浮点 `1.5`，确认 `Number.isInteger(Number(...)) && >0` 判定不被绕过；触发字段只出现 `step_id`（来自 anchor）单字段，确认判为部分 GP。
- 重复提交: 同一 payload 连续两次组包，确认判定纯幂等、无状态残留。
- 中途中断: N/A（同步纯函数，无异步中断点）。
发现分级: P0/P1（journey-only 仍假死 / 部分 GP 被放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| journey-only 组包不误杀 | `tests/dispatcher-gp-identity.test.js`（TDD Red 参考）+ generator 移植进 `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`（永久回归） | journey-only spawn:generator-fix 组包成功且不注入 gp_contract；仅 journey_id 且非法格式仍旁路 GP 全字段校验；出现任一 GP 身份字段但不全 → 继续 fail-closed；完整 GP 身份 → gp_contract 结构化透传不变；空 payload → 返回 null | 修复前 journey-only / journey-illegal 两条 red（assembly_fault / GP_CONTRACT_IDENTITY_INVALID）→ 2 failures |

## notes

- contract-gate: present (cecelia worktree)
- judgment-pending-user: none（PrepPRD 假设段已拍定触发字段集）
- postgres=false：本单无 DB 写路径，无 integration/PG 依赖。
- validation identity late-bound：本合同无 attempt/capability 身份字面值（组包判定不涉及运行时角色身份注入），N/A。
