# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 reason_code + fail-closed 出口（r37）

**journey_type**: autonomous
**target_environment**: local_api

## 锚定父路声明

独立小路（无父路） — journey e6f803f2 golden-paths 返回空，本 sprint 为 harness impact 裁决层的独立缺陷修复（第八处空转黑洞），无历史父路可挂。

## Response Schema（推导来源: PRD 明确 — 本任务无 HTTP 端点，schema 为 `evaluateDiffGate` 步骤 3a 的函数返回对象）

本 sprint 不新增/改动 HTTP 端点（纯内存 gate 裁决函数），无 curl/jq 可 codify 的 HTTP 响应。被测口径是 `evaluateDiffGate(...)` 在「Mapper 返回 freshness.status !== 'fresh'」分支（步骤 3a）的返回对象，字段约束如下（node 断言 codify，见 ## E2E 验收 与 DoD）：

### Function: `evaluateDiffGate({ db, taskId, mapClient, headRevision, changedFiles, repo })` — 步骤 3a 返回对象

```json
{"gate": "impact_unknown", "reason": "mapper_stale", "reason_code": "<string|null>", "retryable": "<boolean>"}
```

- `gate` (string, 必填): 恒为 `"impact_unknown"`（非 fresh 不进入 pass/extend/drift 裁决）。来源——PRD Golden Path step 3（现状已满足，不回退）。
- `reason_code` (string|null, 必填): **原样透传** `mapperResult.freshness.reason_code`；Map 未给出（缺失/为 null）时为 `null`。来源——PRD Golden Path step 2 + ASSUMPTION「确定性结论以 reason_code 非空表达」。**禁止**恒定为 `"mapper_stale"` 掩盖真实 reason_code。
- `retryable` (boolean, 必填): `reason_code == null ? true : false`。即 Map 给出确定性权威结论（reason_code 非空）→ `false`（fail-closed 终态，调度不再重排）；无 reason_code（freshness 缺失 或 unknown 短暂不可判定）→ `true`。来源——PRD 边界情况 2/3 + Golden Path step 2。
- `reason` (string, 必填): 保持 `"mapper_stale"` 高层标签不变（向后兼容，下游若 key on `reason` 不破）。来源——现状字段，PRD 只要求新增 `reason_code` 透传，不要求改 `reason`。

**禁用字段名**: 不得把透传值写成 `reason`（那是高层标签）、`code`、`mapper_reason`；透传口径字面就叫 `reason_code`（对齐 map-client freshness 契约 `{ status, reason_code }` 与本文件既有返回字段名 `reason_code`）。

**Error/异常路径**: reason_code 为下游未知的新枚举值时，透传不得报错崩溃（对齐 status 枚举全仓库对账铁律）——函数正常返回该字符串，无 throw。

---

## Golden Path

`evaluateDiffGate` 调用 → Mapper 返回带 `freshness.reason_code` 的确定性结论 → gate 透传 reason_code 并按可判定性决定 retryable → 出口终态可观察，不再空转。

### Step 1: 触发条件 — Mapper 返回 freshness.status !== 'fresh'

**来源**: `[FROM_PRD]` — Golden Path step 1「evaluateDiffGate 调用 mapperFn，返回 freshness.status !== 'fresh'」。

**可观测行为**: gate 进入步骤 3a 非 fresh 分支（不进入 pass/extend/drift），返回 `gate === 'impact_unknown'`。

**验证命令**:
```bash
# 见 ## E2E 验收 step 3 node 冒烟：三边界 mapClient 均落 impact_unknown 分支
```

**硬阈值**: `gate === 'impact_unknown'`。

---

### Step 2: 系统处理 — 透传 reason_code + 按可判定性决定 retryable

**来源**: `[FROM_PRD]` — Golden Path step 2 +边界情况 2/3 + ASSUMPTION「确定性结论以 reason_code 非空表达」。

**可观测行为**:
- freshness 携带确定性 `reason_code`（非空）→ 返回对象 `reason_code` 等于该值，`retryable === false`（fail-closed 终态）。
- freshness 缺失 或 `status='unknown'` 无 reason_code → `reason_code === null`，`retryable === true`（短暂不可判定，允许重试）。

**验证命令**:
```bash
# 见 ## E2E 验收 step 3 node 冒烟 + DoD B-01/B-02/B-04
```

**硬阈值**: `stale + reason_code='X'` → `{reason_code:'X', retryable:false}`；`unknown + null` → `{reason_code:null, retryable:true}`。

---

### Step 3: 出口 — 确定性结论终态可观察，空转终止

**来源**: `[FROM_PRD]` — Golden Path step 3「确定性结论出口 retryable === false，调度不再对同一确定性结论无限重排」。

**可观测行为**: 确定性结论出口 `retryable === false`；reason_code 非恒定 `mapper_stale`，trace 可观测真实 reason_code；`deny:impact` 空转终止。freshness 缺失时终态可观察且不假绿（未被误判为 pass）。

**验证命令**:
```bash
# 见 ## E2E 验收 step 1（frozen sprint 回归）+ step 2（module 回归）
```

**硬阈值**: 回归测试修复前红、修复后绿；`retryable === false` 对确定性结论成立。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [diff-gate.test.js] → fail-closed：Mapper 异常时 Diff Gate 不假绿（fact_revisions 缺 repo / revision_mismatch / manifest_digest_mismatch 均 impact_unknown + retryable:true）——本 sprint 不得回退这些既有 fail-closed 语义（我的改动只在 freshness 非 fresh 分支细分 reason_code/retryable，其余分支不动）。
- [map-client.js:116 注释] → freshness 契约 `{ status: 'fresh'|'stale'|'unknown', reason_code: string|null }`，确定性结论以 reason_code 非空表达。

### 累积 FR（Step 1.3）
- context-manifest: 本 line（journey e6f803f2）golden-paths 返回空，无 done/working ability，无累积 FR 约束。

### Unified Map 影响半径（Step 1.0）
- `[MAP_NOT_CONFIGURED]` — task.payload 无 map_scope/map_repo，radius 未配置，不回退领域硬编码。

---

## 禁 mock 边清单

本单改动落在 `evaluateDiffGate` 步骤 3a 的**纯内存裁决逻辑**（读 `mapperResult.freshness.reason_code` → 计算 `reason_code`/`retryable` → return），该分支在触达任何 DB 写/相邻模块副作用**之前**就返回，改的不是模块↔模块或代码↔DB 的接缝边。

- gate 裁决逻辑本身（步骤 3a 的 freshness → reason_code/retryable 计算）：测试必须真调 `evaluateDiffGate`（真实模块，**不** vi.mock/stub diff-gate 或 diff-compare），通过既有 sanctioned 依赖注入范式喂入不同 `freshness` 形态构造输入。这是本单唯一被改的边，已由 sprint 冻结测试 + module 回归真调覆盖。
- 代码 ↔ DB 表：**本分支不触达**（步骤 3a 在 `getActiveImpactContract` 成功后、任何 gap_events/tasks 写路径之前返回）。故清单无 DB 边；DB 用轻量 stub 仅为让步骤 1 取到 active 合同以进入步骤 3a，与被改逻辑无关。runtime_resources.postgres=false 亦印证被测路径无需真 Postgres。

（说明：调度侧重试语义、map-client freshness 生成均在 PRD 明确的「不在范围内」，不在本单接缝边，故不列。）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 步骤 3a 透传 `mapperResult.freshness.reason_code` 进 verdict；确定性结论（reason_code 非空）走 fail-closed（retryable:false），短暂不可判定（无 reason_code）保留 retryable:true。 |
| **NFR（做得多好）** | 纯内存裁决，无外部超时；可观测：出口必须暴露真实 reason_code（禁恒定 mapper_stale 掩盖）。 |
| **Invariant（永不违反）** | 语义不分叉铁律：reason_code/status 枚举在判变端（gate）与终验端必须同一处理策略；透传新枚举值不崩溃；fail-closed 原则不假绿（非 fresh 恒返回 impact_unknown，绝不 pass）。 |
| **判定点（怎么知道）** | 见下方登记表（Map 是否给出确定性结论 = reason_code 是否非空）。 |
| **保质期（何时过期）** | N/A — 无 token/数据保质期；纯逻辑修复。 |
| **死亡告警（停了谁知道）** | N/A — 本修复的效果即是消除 `deny:impact:mapper_stale` 空转；空转是否复发由 harness run trace 的 reason_code 可观测性兜底。 |
| **失败语义（挂了怎么办）** | 见下方失败语义声明。核心：确定性结论 = 拦截（retryable:false，调度不再重排）；短暂不可判定 = 放行重试（retryable:true）。 |
| **效果确认（已发≠已生效）** | 回归测试红→绿 + node 直调三边界断言 + module CI 永久回归；trace 中 reason_code 非恒定 mapper_stale 即确认生效。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ Map 是否给出确定性权威结论（决定 retryable） | A. reason_code 非空即确定性; B. 按 status 值（stale=确定/unknown=短暂）; C. 两者组合 | A. reason_code 非空即确定性（reason_code==null → retryable:true；非空 → retryable:false） | PRD ASSUMPTION「确定性结论以 reason_code 非空表达」+ Golden Path step 2 + 边界 2/3；单谓词，语义在判变端/终验端同一（语义不分叉铁律） | 误判确定性为短暂 → 无限重试空转复发（本 sprint 主修的病）；误判短暂为确定 → 本可重试的暂态被 fail-closed 卡死 |
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 示例保留供解析跳过 | 静默丢消息 |

> ⚠️ 判定点说明（PRD 内部张力，待 Reviewer/主理人复核）：PRD **边界情况第 1 行**「freshness 完全缺失 → 维持 fail-closed **终态**」与 **Golden Path step 2**「freshness **缺失**或 unknown 无 reason_code → 保留 retryable:true」在「缺失 freshness 的 retryable 取值」上字面冲突。本合同按**单谓词** `retryable = (reason_code == null)` 解析（缺失 freshness → reason_code null → retryable:true），依据：① ASSUMPTION 明确「确定性以 reason_code 非空表达」；② Golden Path step 2 显式把「freshness 缺失」归入 retryable:true；③ E2E 验收点 3 仅要求缺失时「终态可观察、不假绿」（gate=impact_unknown、非 pass），未把 retryable 钉成 false。此处「fail-closed」取本文件既有语义 = 返回 impact_unknown 不假绿（非「retryable:false」）。生产中真 `queryImpactRadius` 已校验 freshness 必存在，缺失仅为防御性边界，retryable 取值实际近乎 moot。`judgment-pending-user: Map 确定性判定谓词（reason_code 非空）`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper 确定性结论（stale + reason_code） | 返回 impact_unknown + 真实 reason_code + retryable:false（fail-closed 终态） | 否（终态，调度不重排） | 无——这是正确终态，需人/上游改事实而非重试 |
| Mapper 短暂不可判定（unknown 无 reason_code / freshness 缺失） | 返回 impact_unknown + reason_code:null + retryable:true | 是（幂等：同输入同输出，纯函数） | 调度可重排等待 Map 转 fresh |
| reason_code 为未知新枚举 | 原样透传，不 throw | 是 | 下游按未知码处理，gate 不崩 |

### 输入对抗面

N/A — 非对外暴露 agent；输入为 harness 内部 Mapper 投影结果（受 map-client 合同校验），无外部用户可写入面。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

> **无 Postgres 说明**：runtime_resources.postgres=false，且本 sprint 被测路径（步骤 3a）在触达任何 DB 写/连接之前返回（DB 仅轻量 stub 供步骤 1 取 active 合同）。故 E2E 为纯 node/vitest 逻辑验证，无 psql / 无 migration bootstrap（对齐 PRD「本地 evaluator 直调 evaluateDiffGate + vitest，localhost 无外部机器」）。
> **vitest 工作目录**：sprint 冻结测试从仓库根用根 vitest 配置跑（sprints/** 在 include）；packages/brain/src/** 模块回归必须子 shell 切进包根用该包 vitest 配置。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 冻结回归测试（sprints/**，仓库根 vitest 配置）——修复前红、修复后绿
npx vitest run --no-cache "sprints/08211355-kernel-6cd7610b/tests/diff-gate-reason-code.test.js" --reporter=verbose

# 2. 模块永久回归（packages/brain 自己的 vitest 配置，子 shell 切进包根）
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js )

# 3. node 直调 evaluateDiffGate 三边界冒烟（真实执行，exit code 驱动）
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const mkdb=()=>({query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'base123',contract_body:{affected_capabilities:[],required_assertions:[]}}]})}); const base=m=>({db:mkdb(),taskId:'t',headRevision:'h',repo:'cecelia',changedFiles:['x'],mapClient:m}); const det=await evaluateDiffGate(base(async()=>({freshness:{status:'stale',reason_code:'MAP_DELETED_NODE'},affected_nodes:[],required_assertions:[]}))); if(det.gate!=='impact_unknown'||det.reason_code!=='MAP_DELETED_NODE'||det.retryable!==false){console.error('FAIL 确定性',JSON.stringify(det));process.exit(1)} const unk=await evaluateDiffGate(base(async()=>({freshness:{status:'unknown',reason_code:null},affected_nodes:[],required_assertions:[]}))); if(unk.reason_code!==null||unk.retryable!==true){console.error('FAIL unknown',JSON.stringify(unk));process.exit(1)} const miss=await evaluateDiffGate(base(async()=>({affected_nodes:[],required_assertions:[]}))); if(miss.gate!=='impact_unknown'||miss.verdict!==undefined||miss.reason_code!==null){console.error('FAIL 缺失',JSON.stringify(miss));process.exit(1)} const nu=await evaluateDiffGate(base(async()=>({freshness:{status:'stale',reason_code:'BRAND_NEW_ENUM_9999'},affected_nodes:[],required_assertions:[]}))); if(nu.reason_code!=='BRAND_NEW_ENUM_9999'||nu.retryable!==false){console.error('FAIL 新枚举',JSON.stringify(nu));process.exit(1)} console.log('OK: reason_code 透传 + fail-closed 出口四边界通过')"

echo "✅ Diff Impact Gate reason_code 透传 E2E 通过"
```

**通过标准**: 脚本 exit 0（三步全过：sprint 回归绿 + module 回归绿 + node 四边界冒烟 OK）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本 sprint 为纯逻辑小改，风险面窄）
高风险面:
- 错输入: mapClient 返回 `freshness.reason_code` 为非字符串（数字/对象/空字符串 `''`）——透传应不崩溃；空字符串 `''` 属「非 null」还是「无确定性结论」需观察（`'' == null` 为 false，故按谓词 `'' → retryable:false`，确认符合预期语义）。
- 重复提交: 同一确定性结论连续多次调用 evaluateDiffGate —— 应每次同返回（幂等纯函数），不产生累积副作用。
- 中途中断: N/A（同步纯函数无中断点）。
- 边界值: reason_code 为超长字符串 / 含全角/emoji —— 透传应原样保留不截断不崩。
发现分级: P0/P1（透传崩溃 / 确定性结论仍 retryable:true 空转复发）→ 阻塞 merge；P2/P3（`''` 语义边界等）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| reason_code 透传 + fail-closed 出口 | `sprints/08211355-kernel-6cd7610b/tests/diff-gate-reason-code.test.js` | stale + 确定性 reason_code 透传该 reason_code 且 fail-closed retryable=false / unknown 无 reason_code 属短暂不可判定 retryable=true / freshness 缺失 → 终态可观察不假绿 / reason_code 为下游未知的新枚举值：透传不崩溃且 fail-closed | 4 failures（现状 reason_code=undefined、retryable=true）|
| 模块永久回归（补充行） | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | stale + 确定性 reason_code → 透传 reason_code 且 retryable=false / unknown 无 reason_code → 短暂不可判定 retryable=true / freshness 缺失 → 终态可观察不假绿 / reason_code 为下游未知的新枚举值 → 原样透传不崩溃 | 4 failures（20 既有绿不动）|

## notes

- contract-gate: packages/brain/src/lib/contract-gate.js 存在（cecelia worktree），代码层 Contract Gate 正常生效，本合同断言按速查表 gate-clean 写法（node -e 单 pipeline 值断言 / vitest exit-code 驱动）。
- judgment-pending-user: Map 确定性判定谓词（reason_code 非空 → fail-closed）；及 freshness 缺失时 retryable 取值（PRD 边界 1 vs Golden Path step 2 字面张力，本合同按单谓词解析为 retryable:true，见判定点登记表 ⚠️ 说明）。
