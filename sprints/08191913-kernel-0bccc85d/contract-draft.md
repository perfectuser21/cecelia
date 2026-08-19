# Sprint Contract Draft (Round 1)

**Sprint**: Diff Impact Gate 透传 reason_code 并 fail-closed 出口
**journey_type**: autonomous
**target_environment**: local_api
**锚定父路声明**: 独立小路（无父路）— journey e6f803f2 的 golden-paths 仅含 planned ability（Agent 一键归零重置），无 done/working 历史；本 sprint 是 harness 内核缺陷修复，不推进业务 GP。

## 影响半径 / Unified Map

`[MAP_NOT_CONFIGURED]` — 依 PRD 假设：payload 提供 `map_scope=["F1"]` 但缺 `map_repo`，scope 锚定退化为 F1「造完真验」，不做领域猜测。`must_run_assertions` 空；本 sprint 影响半径以 PRD「预期受影响文件」+ 全仓库 `mapper_stale` grep 同步为准（见「已知约束」）。

## gp-anchor: skipped (product-map.json not found)

（cecelia 仓无 `product-map/generated/product-map.json`，GP-Anchor 段整体跳过，不阻塞。）

## contract-gate: skipped (file not found, third-party repo?)

本仓库为 cecelia，`packages/brain/src/lib/contract-gate.js` 存在与否由 GAN 收敛时代码层 gate 决定；本 skill 内置规则（速查表 + 自查 + Reviewer 维度）已逐条执行。

---

## Response Schema（推导来源: PRD 字面 + 现有 gate 返回 shape）

本 sprint 主体是**内部 gate 函数返回对象**语义修正；同时同步一个 HTTP 表面（`POST /api/brain/tasks/:taskId/impact-contract/diff-evaluate`）。

### 内部函数 `evaluateDiffGate(...)` 返回（非 fresh 分支）

```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string>", "retryable": true}
```

- `gate` (string): 非 fresh 时固定 `"impact_unknown"`（来源: 现有 shape，不变）
- `reason` (string): **透传 Mapper `freshness.reason_code`**；缺失时 fallback（stale→`"mapper_stale"`，unknown→`"impact_unknown"`）（来源: PRD「透传具体 reason_code」）
- `reason_code` (string): 与 `reason` 同值（下游 `harness-gates.js:30` 取 `result.reason ?? result.reason_code`，双写保证 kernel 与 HTTP 两表面一致）（来源: 现有 harness-gates gateReceipt shape）
- `retryable` (boolean): 瞬态 stale → `true`；确定性 unknown → **`false`**（fail-closed）（来源: PRD Golden Path step 2）

**禁用值**: `reason` 严禁在确定性 unknown 下折叠成通用 `"mapper_stale"`（PRD 核心缺陷）；`retryable` 在确定性 unknown 下严禁为 `true`（无限空转根因）。

### 内部函数 `evaluateStructureGate(...)` 返回（非 fresh 分支）

```json
{"gate": "blocked", "reason": "<string>", "reason_code": "<string>", "retryable": false, "httpStatus": 422}
```

- 瞬态 stale → `retryable:true, httpStatus:503`，`reason` 透传 `freshness.reason_code`（缺失 fallback `"mapper_stale"`）
- 确定性 unknown → `retryable:false, httpStatus:422`（非 503/409，故 `buildBlockedResult` 天然 `retryable:false`），`reason` 透传 `reason_code`（缺失 fallback `"impact_unknown"`）

### HTTP `POST /tasks/:taskId/impact-contract/diff-evaluate`

**Success/pass**: 200；**drift**: 409（不变）
**impact_unknown（本 sprint 语义分流）**:
```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string>", "retryable": false}
```
- `retryable:true`（瞬态）→ HTTP **503**（不变）
- `retryable:false`（确定性 unknown）→ HTTP **422**（新增：非重试语义不再冒充 503 retryable）

---

## Golden Path

[orchestrator loop 对有 active impact contract 的 task 触发 Diff Impact Gate] → [Gate 依据 Mapper freshness.status 语义分流] → [有界重试(retryable:true) 或 确定性拒绝(retryable:false fail-closed)，不再 deny:impact:mapper_stale 空转]

判别器（判定点）：**`mapperResult.freshness.status === 'unknown'` 即确定性 unknown（fail-closed）；其余非 fresh（含 `stale`、freshness 缺失）保守按瞬态（retryable）**。freshness 枚举 = `fresh|stale|unknown`（SSOT: `contract-schema.js:136` `z.enum(['fresh','stale','unknown'])`、`map-client.js:116` 返回 shape）。

---

### Step 1: 瞬态 stale → 透传具体 reason_code，retryable:true
**来源**: `[FROM_PRD]` — PRD Golden Path step 2「瞬态陈旧 → retryable:true，且透传 Mapper 给出的具体 reason_code（如 fact_snapshot_stale），不再一律写成 mapper_stale」

**可观测行为**: `evaluateDiffGate` 收到 `freshness.status='stale', reason_code='fact_snapshot_stale'` → 返回 `gate:'impact_unknown', retryable:true, reason_code:'fact_snapshot_stale'`（reason 非 `mapper_stale`）。

**验证命令**:
```bash
cd /workspace && node sprints/08191913-kernel-0bccc85d/checks/assert-diff-stale-passthrough.mjs
# 期望：exit 0，OK B-01 ... reason_code=fact_snapshot_stale
```
**硬阈值**: `retryable===true` 且 `reason_code==='fact_snapshot_stale'` 且 `reason!=='mapper_stale'`

---

### Step 2: 确定性 unknown → fail-closed（retryable:false），透传 reason_code
**来源**: `[FROM_PRD]` — PRD Golden Path step 2「确定性 unknown → fail-closed 出口：retryable:false 且透传具体 reason_code（如 impact_unknown），gate 判 deny 且不可重试」

**可观测行为**: `evaluateDiffGate` 收到 `freshness.status='unknown', reason_code='impact_unknown'` → 返回 `gate:'impact_unknown', retryable:false, reason_code:'impact_unknown'`。

**验证命令**:
```bash
cd /workspace && node sprints/08191913-kernel-0bccc85d/checks/assert-diff-unknown-failclosed.mjs
# 期望：exit 0，OK B-02 ... fail-closed retryable:false
```
**硬阈值**: `retryable===false` 且 `reason_code==='impact_unknown'`

---

### Step 3: structure-gate 与 diff-gate 同一语义分流策略（跨端一致）
**来源**: `[FROM_PRD]` — PRD 边界情况「structure-gate.js 的 mapper_stale 折叠必须与 diff-gate 采用同一语义分流策略（判变端与终验端不得分叉，否则开假绿面）」+ Invariant [语义跨端一致]

**可观测行为**: `evaluateStructureGate` 对 `stale` → `blocked, retryable:true, reason` 透传；对 `unknown` → `blocked, retryable:false`（httpStatus 422）。分流判别器与 diff-gate 逐字段一致。

**验证命令**:
```bash
cd /workspace && node sprints/08191913-kernel-0bccc85d/checks/assert-structure-split.mjs
# 期望：exit 0，OK B-03 structure-gate 同语义分流
```
**硬阈值**: stale→`retryable:true & reason==='ttl_exceeded'`；unknown→`retryable:false`

---

### Step 4: orchestrator loop 消费 retryable=false → 立即终止该 intent（不再空转）
**来源**: `[FROM_PRD]` — PRD Golden Path step 3「orchestrator loop 收到 gateVerdict：retryable=false 时立即终止该 intent 的重试（不再 deny:impact:mapper_stale 空转）；retryable=true 时按具体 reason_code 有界重试」

**⚠️ 关键事实（诚实标注）**: `loop.js:1661-1665` **已有**该消费逻辑——`BLOCKED && failure_class==='impact_contract_invalid'`（由 `retryable===false` 在 `loop.js:1542` 映射）→ `failRun('impact_gate_deterministic:...')` 立即终止；`retryable!==false` → `infrastructure_blocked` → 退避复探（由 run deadline 收敛）。**因此 `loop.js` 本 sprint 无 production 代码改动**；根因 100% 在两个 gate 把所有非 fresh 折叠成 `retryable:true`。本步为**消费回归锁**（防未来回归），非新增消费逻辑。

**可观测行为**: 注入 `impactGate` 返回 `{gate:'impact_unknown', reason:'impact_unknown', retryable:false}` → `runLoop` 以 `exitReason:'impact_gate_deterministic'` 终止，`deps.dispatch` 不再被反复调用（无空转）；对照组 `retryable:true` 走 `infrastructure_blocked` 退避。

**验证命令**:
```bash
# loop 消费回归随 B-05 全仓库回归一并跑（loop.test.js 新增用例）
cd /workspace && (cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js)
# 期望：exit 0，loop.test.js 全绿（含 retryable:false → 终止、retryable:true → 退避两用例）
```
**硬阈值**: loop.test.js 全绿；新增用例断言 `exitReason==='impact_gate_deterministic'`（retryable:false）

---

### Step 5: HTTP diff-evaluate 表面反映 retryable（422 vs 503）+ 文档同步
**来源**: `[FROM_PRD]` — PRD「预期受影响文件」列 `routes/impact-contracts.js:207 响应 reason 语义/文档同步」+ Invariant [语义跨端一致]（HTTP 表面与内核不得分叉）

**可观测行为**: `diff-evaluate` 路由对 `gate==='impact_unknown'` 依 `retryable` 分状态码：`retryable===false` → **422**（非重试），否则 **503**（不变）；路由 doc 注释（第 207/241 行）同步说明确定性 unknown → 422 fail-closed。

**验证命令**:
```bash
# 静态断言路由按 retryable 分流（源码含 retryable 判定 + 422 分支）
cd /workspace && node -e "const c=require('fs').readFileSync('packages/brain/src/routes/impact-contracts.js','utf8'); const ok=/impact_unknown/.test(c)&&/retryable/.test(c)&&/422/.test(c); if(!ok){console.error('FAIL: diff-evaluate 路由未按 retryable 分 422/503');process.exit(1)} console.log('OK Step5 路由 retryable→422/503 分流存在')"
# 期望：exit 0
```
**硬阈值**: 路由源码含 `impact_unknown` + `retryable` + `422` 分支（[ARTIFACT] 层，见 DoD）

---

### Step 6: 边界 — freshness 缺 reason 细分字段（只 status）→ 保守 fallback，不静默丢/不误判
**来源**: `[FROM_PRD]` — PRD 边界情况「freshness 缺失 reason 细分字段（只有 status: stale）→ 无法判定确定性时，保守按瞬态处理但仍透传原始 reason（不得静默丢弃）」

**可观测行为**: `status:'stale'` 无 reason_code → `retryable:true`，reason fallback `mapper_stale`（有具体值才透传，不静默丢真值）；`status:'unknown'` 无 reason_code → 仍 `retryable:false`，reason fallback `impact_unknown`（确定性判别只依 status，不依赖 reason_code 是否齐全）。

**验证命令**:
```bash
cd /workspace && node sprints/08191913-kernel-0bccc85d/checks/assert-missing-reason.mjs
# 期望：exit 0，OK B-04 缺 reason_code 语义正确
```
**硬阈值**: staleNoCode→`retryable:true`；unknownNoCode→`retryable:false`

---

## 已知约束（回归测试 + 累积 FR + 铁律映射）

### 回归测试约束（Step 1.2 — grep 现有硬编码 mapper_stale 断言，[status枚举同步] 铁律要求全仓库同步）

- `structure-gate.test.js:148/155` → `test('Mapper stale 响应包含 reason=mapper_stale')` `expect(result.reason).toBe('mapper_stale')`。**必改**：`makeStaleFreshnessMapClient` 返回 `freshness:{status:'stale', reason_code:'ttl_exceeded'}`，修复后 gate 透传 → reason 变 `ttl_exceeded`。断言与标题需同步为透传语义（`toBe('ttl_exceeded')`），否则转红。
- `harness-gates.test.js:395/409` → beforeMerge 测试**注入 diffGate mock** 返回 `reason:'mapper_stale'`，不走真 gate，**不受本改动影响**（保持绿）；另在本文件**新增** fail-closed 用例（真/mock diffGate 返回 `retryable:false` → beforeMerge 透传 `retryable:false`）。
- `loop.test.js:340/348` → 注入 `impactGate` mock 返回 `reason:'mapper_stale'`，**不受影响**；另**新增**用例：impactGate 返回 `retryable:false` → runLoop `exitReason:'impact_gate_deterministic'`；`retryable:true` → 退避不终止。
- `map-client.test.js:109` → 措辞含 "mapper_stale"，是 map-client 层旧 revision 证据用例，**不在本 sprint 范围**（Mapper freshness 判定不改），不动。

### 累积 FR（Step 1.3 — context-manifest）

`context-manifest: unavailable`（runtime_resources.postgres=false 且 Brain 未运行，端点不可达）。PRD「累积 FR」段声明本 line 暂无已验收历史（journey e6f803f2 golden-paths 仅 planned ability），故无累积 FR 约束需锁。

### 铁律映射（Step 1.3 — controller 注入铁律逐条映射，见 DoD INV-N）

见 contract-dod.md `## Invariant 覆盖` 段（INV-1..INV-7）。

---

## 禁 mock 边清单（v9.12 硬规则）

本单改动涉及**跨模块数据传递**（gate → harness-gates → loop 的 `reason_code`/`retryable` 接力）与**状态机消费**（loop 依 `retryable` 分 terminate/backoff）。故 failing test 不 mock 被改的边：

- **diff-gate.js 的 freshness→verdict 分流逻辑**（本单改的核心边）：测试必须真调 `evaluateDiffGate`，**不 mock gate 本身**；只允许注入 `mapClient`（Mapper 的 HTTP `/map/radius` 外部边界，本 sprint 未改，是 gate 签名既有的测试缝）。
- **structure-gate.js 的 freshness→verdict 分流逻辑**（同一被改边的终验端）：测试必须真调 `evaluateStructureGate`（`db:null` 走 freshness 早退分支），只注入 `mapClient`。
- **loop.js 的 `retryable`→`failure_class`→`failRun`/backoff 消费边**：`loop.test.js` 必须真跑 `runLoop`（真 loop.js 消费逻辑），仅注入既有的 `deps.impactGate` receipt 缝——注意 **loop.js 本 sprint 无 production 改动**，此边是「消费不回归」的锁，非被改的边。
- **DB 写路径未触达**：本改动全部落在 3a/规则 3 的 freshness 早退分支，位于任何 `db.query`/gap 写入/blockTask 之前 → 无 DB 写路径改动，故不需要真 Postgres（与 runtime_resources.postgres=false 一致）。

---

## 未覆盖真实链路清单（mock 豁免显式登记 — v9.10 规则 C）

| 被替身顶替的链路点 | 为什么 | 真验证补位计划 |
|---|---|---|
| Mapper HTTP `/api/brain/map/radius`（`queryImpactRadius`）真实网络调用 | PRD 范围明确排除「Mapper（queryImpactRadius）本身的 freshness 判定逻辑改造」；本 sprint 只改 gate 对 Mapper **已产出** freshness 的消费分流。gate 签名本就提供 `mapClient` 注入缝，用它喂各种 freshness 形态是**被测边（freshness→verdict）的真实执行**，非造假 | Mapper 层由其自有 sprint 的集成测试（map-client.test.js 真 fetch 桩）覆盖；本 sprint 的被改边（分流逻辑）已由 B-01..B-04 真调 gate 100% 覆盖，无遗留 |
| 真实 Postgres（gap 写入 / blockTask / persist active contract） | 本改动全部落在 freshness 早退分支，位于任何 DB 写路径**之前**即 return，DB 路径不被触达（与 runtime_resources.postgres=false 一致） | N/A — 被改边不触达 DB；DB 写路径由既有 __tests__ 集成用例覆盖，本 sprint 不改 |

> 说明：以上不构成「被改的边被 mock」——被改的边（`freshness.status`→`{retryable,reason_code}` 分流）在 B-01..B-05 中全部真实执行；被登记的是**范围外**且**早退分支不触达**的下游依赖。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | Diff/Structure Gate 对非 fresh 按 `freshness.status` 分流：瞬态 stale→retryable:true 透传 reason_code；确定性 unknown→retryable:false fail-closed 透传 reason_code。HTTP diff-evaluate 表面按 retryable 分 422/503。 |
| **NFR（做得多好）** | | 频控/重试：确定性 unknown 必须 retryable=false（有界，杜绝无限空转）。超时/延迟：PrepPRD 未指定，N/A。可观测：gate 拒绝必须透传具体 reason_code。 |
| **Invariant（永不违反）** | | 见 INV-1..INV-7。核心：失败路径不降级（非零出口/fail-closed）；语义跨端一致（diff-gate=structure-gate 分流）；status 枚举硬编码断言全仓库同步。 |
| **判定点（怎么知道）** | | 见判定点登记表（瞬态 vs 确定性判别）。 |
| **保质期（何时过期）** | | freshness 枚举 `fresh|stale|unknown` 由 Mapper/contract-schema SSOT 定义；新增枚举值时本分流需复审（枚举扩展 = 复审触发）。 |
| **死亡告警（停了谁知道）** | | 分流退化（又折叠成 mapper_stale）→ 表现为 `deny:impact:mapper_stale` 空转复现；由 loop 的 `blocked_same_state` cap（BLOCKED_SAME_STATE_CAP）与 run deadline 兜底终止，orchestrator 日志可见。回归测试（B-01..B-05）守护。 |
| **失败语义（挂了怎么办）** | | 见失败语义声明。确定性 unknown = 拦截（fail-closed，retryable:false，failRun 终止 intent）；瞬态 = 有界重试（retryable:true，run deadline 收敛）；freshness 无法判定 = 保守按瞬态（宁可有界重试也不误 failRun 放弃可恢复 intent）。 |
| **效果确认（已发≠已生效）** | | 每个 gate 返回对象由 B-01..B-04 真调断言 `retryable`/`reason_code`；loop 消费由 loop.test.js 真跑 runLoop 断言 `exitReason` 确认「retryable:false 真的终止」。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ Mapper 非 fresh 是「瞬态陈旧」还是「确定性 unknown」 | A. 按 `freshness.status` 枚举（`unknown`=确定性，`stale`/缺失=瞬态）; B. 按 `reason_code` 白名单匹配 | A. 按 `freshness.status` 枚举 | status 枚举是 Mapper 契约 SSOT（`z.enum(['fresh','stale','unknown'])`），确定性/瞬态语义天然由 `unknown` vs `stale` 承载；reason_code 是自由文本细分，做白名单会引入跨端漂移与维护负担（违反 [语义跨端一致]） | 误判确定性为瞬态 → 无限空转（本 sprint 修的算力浪费根因）；误判瞬态为确定性 → 过早 failRun 放弃本可恢复的 intent。故 status 不明确（缺失/非枚举）时**保守按瞬态**（宁可有界重试）。 |

> ⚠️ 行说明：该判定点误判后果严重（无限空转 / 过早放弃 intent），属「升拍板点」级别。PRD Golden Path step 2 + 假设段已明确「按 status 区分、字段不足时保守瞬态」，视为已由 PrepPRD 拍过；无需 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写 DB | 是 | 客户端重试 |
| Mapper 确定性 unknown（status='unknown'） | gate=impact_unknown, retryable:false；loop failRun('impact_gate_deterministic') 终止 intent；HTTP 422 | 幂等（纯函数，同输入同判） | **不降级**（[失败路径不降级]）——fail-closed 拒绝，绝不假绿放行 |
| Mapper 瞬态 stale（status='stale'/缺失） | gate=impact_unknown, retryable:true 透传 reason_code；loop infrastructure_blocked 退避；HTTP 503 | 幂等 | 有界重试，run deadline 收敛（非无限） |
| freshness 完全缺失（无 freshness 对象） | 按瞬态：retryable:true，reason fallback mapper_stale | 幂等 | 保守有界重试（不误 fail-closed） |

### 输入对抗面

N/A — 本 sprint 是 harness 内核 gate 逻辑，非对外暴露 agent；输入来自内部 Mapper 复算结果（可信内部边界），无 prompt injection / 越权指令面。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `evaluateDiffGate` 的 `mapClient` 返回 `freshness.status` 为非枚举值（如 `'refreshing'`、`''`、数字）→ 应保守按瞬态（retryable:true），不得崩溃、不得误 fail-closed。
- 错输入: `freshness` 为 `null` / `freshness.status` 为 `undefined` → 走「freshness 缺失」保守瞬态分支，不抛异常。
- 重复提交: 同一 `unknown` 输入连调两次 → 两次返回逐字段一致（纯函数幂等，无副作用累积）。
- 边界值: `reason_code` 为 `''`（空字符串）→ 属「有值」还是「缺失」？确认 fallback 逻辑对空串的处理（建议空串视同缺失走 fallback，避免透传空 reason 遮蔽根因）。
- 中途中断: structure-gate `unknown` 分支 `db` 非 null 时是否仍在 persist 之前早退（不落库 active contract）？确认 fail-closed 不产生持久化副作用。
发现分级: P0/P1（无限空转复现 / 误 fail-closed 放弃 intent / 崩溃）→ 阻塞 merge；P2/P3（fallback 措辞）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> 本 sprint 改动落在 gate 的 freshness 早退分支（任何 DB 写路径之前），验证走纯 Node 真调 gate + 包内 vitest 回归，**不需要 Postgres**；与 runtime_resources.postgres=false 一致。E2E 段全部命令从仓库根跑，包内 `src/**` vitest 用子 shell 切进 `packages/brain` 包根（9.25.0 死规则）。

```bash
#!/bin/bash
set -euo pipefail
cd /workspace

# Golden Path Step 1：瞬态 stale → retryable:true 透传 reason_code
node sprints/08191913-kernel-0bccc85d/checks/assert-diff-stale-passthrough.mjs

# Golden Path Step 2：确定性 unknown → fail-closed retryable:false 透传 reason_code
node sprints/08191913-kernel-0bccc85d/checks/assert-diff-unknown-failclosed.mjs

# Golden Path Step 3：structure-gate 与 diff-gate 同语义分流（跨端一致）
node sprints/08191913-kernel-0bccc85d/checks/assert-structure-split.mjs

# Golden Path Step 6：边界 — freshness 缺 reason_code 保守 fallback，不静默丢
node sprints/08191913-kernel-0bccc85d/checks/assert-missing-reason.mjs

# Golden Path Step 5：HTTP diff-evaluate 路由按 retryable 分 422/503（静态断言）
node -e "const c=require('fs').readFileSync('packages/brain/src/routes/impact-contracts.js','utf8'); const ok=/impact_unknown/.test(c)&&/retryable/.test(c)&&/422/.test(c); if(!ok){console.error('FAIL: diff-evaluate 路由未按 retryable 分 422/503');process.exit(1)} console.log('OK Step5 路由 retryable→422/503 分流存在')"

# Golden Path Step 4 + 全仓库回归：三处 __tests__（含 fail-closed 新用例、grep 同步、loop 消费终止锁）从包根跑
( cd packages/brain && npx vitest run --no-cache \
    ./src/impact-contract/__tests__/harness-gates.test.js \
    ./src/impact-contract/__tests__/structure-gate.test.js \
    ./src/orchestrator/__tests__/loop.test.js )

echo "✅ Diff Impact Gate fail-closed Golden Path 验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 瞬态 stale 透传 | `tests/diff-impact-gate-failclosed.test.ts` | `瞬态 stale 透传具体 reason_code 且 retryable:true` | → 5 failed（当前折叠成 mapper_stale/retryable:true 无 reason_code）|
| diff-gate 确定性 unknown fail-closed | `tests/diff-impact-gate-failclosed.test.ts` | `确定性 unknown fail-closed retryable:false` | → 同上 |
| diff-gate 缺 reason_code 保守 | `tests/diff-impact-gate-failclosed.test.ts` | `缺 reason_code 时保守` | → 同上 |
| structure-gate 同语义 stale | `tests/diff-impact-gate-failclosed.test.ts` | `structure-gate stale 透传 reason_code 且 retryable:true` | → 同上 |
| structure-gate 同语义 unknown | `tests/diff-impact-gate-failclosed.test.ts` | `structure-gate unknown fail-closed retryable:false` | → 同上 |

> Test Contract「BEHAVIOR 覆盖」列均为对应 `it()` 名字面子串（可 `grep -F` 命中 tests/diff-impact-gate-failclosed.test.ts）。
