# Sprint Contract Draft (Round 1)

> 合同 round：1 ｜ propose_round=1（`inputs.case_file` 为空，无上一轮 blocker，Step 1.4 跳过）
> contract-gate: skipped (file not found — packages/brain/src/lib/contract-gate.js 不存在于本 worktree)
> gp-anchor: skipped (product-map.json not found)

## 锚定父路声明

独立小路（无父路）—— 本 sprint 只修 `evaluateDiffGate` 步骤 3a 的 mapper 非 fresh 折叠点，不隶属某条已注册 Golden Path。

## Response Schema（推导来源: diff-gate 出口契约 + map-client freshness 契约；无 HTTP 端点）

本 sprint 无新增 HTTP 端点。被改的是内部函数 `evaluateDiffGate(...)` 步骤 3a 的**出口对象**，schema 推导自 diff-gate.js 现有 JSDoc 返回类型（已声明 `reason_code?: string|null` 但 3a 从未填充）与 map-client.js 的 `freshness: { status, reason_code }` 契约。

### 函数出口: `evaluateDiffGate(...)` 步骤 3a（mapper freshness.status !== 'fresh'）

**改动后出口 (gate=impact_unknown)**:
```json
{"gate": "impact_unknown", "reason": "<string>", "reason_code": "<string|null>", "retryable": "<boolean>"}
```
- `gate` (string, 必填): 字面量 `"impact_unknown"` — 来源: PRD 明确（既有语义不变）
- `reason` (string, 必填): 具体 `reason_code` 透传值；`reason_code` 缺失时兜底为 `"mapper_" + status`（如 `mapper_unknown`）— 来源: NEW（透传 map-client `freshness.reason_code`，替代裸 `mapper_stale`）
- `reason_code` (string|null, 必填): 原样透传 `mapperResult.freshness.reason_code`，可为 `null` — 来源: NEW（JSDoc 已声明该字段但 3a 未填充，本次通电；供 RCA `reason_code:layer:step` 去重消费）
- `retryable` (boolean, 必填): `freshness.status==='stale'` → `true`（瞬态可自愈）；`freshness.status==='unknown'` 或 freshness 缺失 → `false`（确定性终态 fail-closed）— 来源: NEW（终态分流，PRD Golden Path Step 3）

**禁用字段名**（不得用同义替换词代替 `reason_code`）: `code` / `errorCode` / `error_code` / `freshness_reason` / `freshnessReasonCode`。透传字段必须字面用 `reason_code`（与既有 JSDoc、RCA dedup 一致）。
**禁用出口**: 不得再返回裸 `reason: "mapper_stale"`（map-client 从不产出 `reason_code === "mapper_stale"`，该字符串是被删除的折叠产物）。

---

## reason_code → terminal 映射（PRD ASSUMPTION 要求：读 map-client / map producer 源码后锁定）

已读 `packages/brain/src/map/radius.js` 的 freshness 产出点，锁定**以 `freshness.status` 为准的确定性分型**（不新增硬编码 reason_code 断言表，规避铁律 [status枚举全仓grep] 的同步脆弱性 —— 直接消费 map producer 已计算的三值 status 枚举）：

| freshness.status | 语义 | 出口 retryable | 涵盖的 reason_code（map/radius.js 实证） |
|---|---|---|---|
| `stale` | 事实快照 / 投影暂时落后，后台刷新可自愈 → **瞬态** | `true` | `fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` |
| `unknown` | 结构性不可判定（缺锚点 / 能力不在投影 / 断言覆盖缺失 / graph revision 分叉），重试产出相同结果 → **确定性终态** | `false`（fail-closed blocked） | `graph_projection_revision_mismatch` / `capability_not_in_active_projection` / `impact_anchor_missing` / `unsafe_assertion_ref` / `assertion_identity_ambiguous` / `capability_assertion_coverage_missing` |
| 缺失 / 其它 | freshness 字段缺失或畸形 → 不可判定且不会自愈 | `false`（fail-closed，兜底 `reason_code=null`, `reason="mapper_unknown"`） | （契约畸形兜底，不崩溃） |

> 与 `map/radius.js` 生产端语义一致：`stale` = 时序落后（可能追上）、`unknown` = Mapper 无法判定（结构性，重试同结果）。此分型同 harness-judge 历轮已通过的 evaluator 结论一致（瞬态 stale→retryable:true 透传 `fact_snapshot_stale`；确定性 unknown→retryable:false 透传具体 code）。

---

## Golden Path

[Mapper 返回非 fresh 结论（带 reason_code）] → [门禁步骤 3a 按 freshness.status 分流 + 透传 reason_code] → [终态 fail-closed 阻断（retryable:false）/ 瞬态可重试（retryable:true）]

### Step 1: Mapper 复算返回非 fresh（带具体 reason_code）
**来源**: `[FROM_PRD]` — Golden Path 第 1 点（`evaluateDiffGate` 调 Mapper，`freshness.status !== 'fresh'` 并带 `freshness.reason_code`）

**可观测行为**: `evaluateDiffGate` 步骤 3a 收到 `mapperResult.freshness = { status: 'stale'|'unknown', reason_code: '<具体码>' }`。

**验证命令**:
```bash
# 注入非 fresh mapper 结果，确认进入 3a 分支（gate=impact_unknown）
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const db={query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'base',contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:'t',repo:'cecelia',headRevision:'h',mapClient:async()=>({manifest_digest:'m',projection_digest:'p',fact_revisions:{cecelia:'base'},affected_nodes:[],required_assertions:[],freshness:{status:'stale',reason_code:'fact_snapshot_stale'}})}); if(r.gate!=='impact_unknown')process.exit(1); console.log('OK',JSON.stringify(r));"
# 期望：gate=impact_unknown
```
**硬阈值**: `gate === "impact_unknown"`。

---

### Step 2: 门禁按 reason_code 分流 + 原样透传
**来源**: `[FROM_PRD]` — Golden Path 第 2 点（不再折叠成扁平 `mapper_stale`；透传 `freshness.reason_code` 到出口 `reason`/`reason_code`）

**可观测行为**: 出口 `reason_code` == mapper 的 `freshness.reason_code`（原样）；出口 `reason` 携带该 code，绝非裸 `"mapper_stale"`。

**验证命令**:
```bash
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const db={query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'base',contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:'t',repo:'cecelia',headRevision:'h',mapClient:async()=>({manifest_digest:'m',projection_digest:'p',fact_revisions:{cecelia:'base'},affected_nodes:[],required_assertions:[],freshness:{status:'stale',reason_code:'fact_snapshot_stale'}})}); if(r.reason_code!=='fact_snapshot_stale'||r.reason==='mapper_stale')process.exit(1); console.log('OK',JSON.stringify(r));"
# 期望：reason_code === "fact_snapshot_stale" 且 reason !== "mapper_stale"
```
**硬阈值**: `reason_code === "fact_snapshot_stale"` 且 `reason !== "mapper_stale"`。

---

### Step 3: 终态 fail-closed / 瞬态可重试
**来源**: `[FROM_PRD]` — Golden Path 第 3 点（确定性终态 → retryable:false blocked；瞬态 stale → retryable:true）

**可观测行为**:
- `freshness.status==='unknown'`（确定性终态）→ 出口 `retryable === false`（下游 loop.js:1542 归 `impact_contract_invalid` → BLOCKED，不再重派 → 终结 `deny:impact:mapper_stale` 无限空转）
- `freshness.status==='stale'`（瞬态）→ 出口 `retryable === true`（保留原有重试）

**验证命令**:
```bash
# 终态 unknown → retryable:false
node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const db={query:async()=>({rows:[{id:'c',repo:'cecelia',base_revision:'base',contract_body:{affected_capabilities:[],required_assertions:[]}}]})}; const r=await evaluateDiffGate({db,taskId:'t',repo:'cecelia',headRevision:'h',mapClient:async()=>({manifest_digest:'m',projection_digest:'p',fact_revisions:{cecelia:'base'},affected_nodes:[],required_assertions:[],freshness:{status:'unknown',reason_code:'impact_anchor_missing'}})}); if(r.retryable!==false||r.reason_code!=='impact_anchor_missing')process.exit(1); console.log('OK',JSON.stringify(r));"
# 期望：retryable === false 且 reason_code === "impact_anchor_missing"
```
**硬阈值**: 终态 `retryable === false`；瞬态 `retryable === true`；两者 `reason` 均含具体 reason_code。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 情形一：实际影响 ⊆ 声明影响放行（pass）
- [diff-gate.test.js] → fail-closed：Mapper 异常时 Diff Gate 不假绿（mapper_unavailable / revision_evidence_missing / revision_mismatch / manifest_digest_mismatch 均 retryable:true）
- [diff-gate.test.js] → drift 触发 gap_events + block 任务（事务 BEGIN/COMMIT）
- 现存 20 条 diff-gate 单测全部使用 `freshness:{status:'fresh'}`，**无任何非 fresh(3a) 断言** → 本 sprint 新增即为该分支首个回归护栏，改动 3a 不回退既有 fresh/3b 断言。

### 来自累积 FR（Step 1.3 — context-manifest）
- context-manifest: unavailable（本 line 仅 1 个 ability 且状态 planned，PRD 累积 FR 段明确「本 line 暂无历史」）

### 来自 Unified Map 必跑断言（Step 1.0）
- [MAP_NOT_CONFIGURED]（task.payload 无 map_scope/map_repo，radius 未配置，无 must_run_assertions 注入）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | `evaluateDiffGate` 步骤 3a 透传 mapper `freshness.reason_code` 到出口 `reason`/`reason_code`，并按 `freshness.status` 分流 retryable（unknown→false 终态，stale→true 瞬态） |
| **NFR（做得多好）** | | 无性能/并发阈值（纯同步分支判断，PrepPRD 未指定）；改动 ≤ ~15 行净增，单文件 diff-gate.js + 两处测试 |
| **Invariant（永不违反）** | | [fail-closed] 任何不可判定 → blocked 不假绿；[retry身份] 不可自愈条件不得标 retryable:true；[status枚举全仓grep] 不新增 status/reason 枚举值（消费既有三值 status） |
| **判定点（怎么知道）** | | 见下方登记表（非 fresh 是终态还是瞬态） |
| **保质期（何时过期）** | | N/A —— 纯确定性分支逻辑，无 token/数据保质期 |
| **死亡告警（停了谁知道）** | | 出口 `reason_code` 进 RCA `reason_code:layer:step` 去重账本；无限重试空转本身即当前告警面（本 sprint 消除） |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 出口对象即时可断言（node 直跑 evaluateDiffGate 读 retryable/reason_code），无异步回执 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ Mapper 非 fresh 结论是确定性终态还是瞬态 | A. 按 `freshness.status`（unknown=终态/stale=瞬态）；B. 硬编码 reason_code→terminal 映射表 | A. 按 `freshness.status` 分流 | map producer（map/radius.js）已计算三值 status 枚举：`stale`=时序落后可自愈、`unknown`=结构性无法判定重试同结果；避免硬编码 reason_code 表触发 [status枚举全仓grep] 同步脆弱性 | 误判终态为瞬态 → 无限重试空转（当前 bug）；误判瞬态为终态 → 本可自愈却 fail-closed 过度拦截阻断任务 |

> ⚠️ 说明：该判定点的分型规则已由 PRD ASSUMPTION 预先授权（"由 Proposer 在 GAN 阶段读 map-client 源码后锁定"），本轮读 `map/radius.js` 源码锁定为 status-based，无需再升拍板点请教用户。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Mapper 抛错不可达 | 出口 `mapper_unavailable` + retryable:true（本 sprint 不改） | 是（无副作用纯判断） | 保留既有重试 |
| freshness.reason_code 为 null/缺失 | 兜底 `reason_code=null` + `reason="mapper_<status>"`，不崩溃；status 缺失按 unknown → retryable:false | 是 | fail-closed blocked（不误判为 fresh，不假绿） |
| freshness.status==='unknown' 确定性终态 | 出口 retryable:false → loop BLOCKED，不重派 | 是 | fail-closed，终结无限重试 |

### 输入对抗面

N/A —— 本 sprint 不新增对外暴露 agent 输入面，改动为内部门禁函数分支逻辑。

---

## 禁 mock 边清单

本单改动落在门禁决策逻辑（状态机相邻：出口 `retryable` 驱动 orchestrator loop.js:1542 的重派/BLOCKED 分流）。被改的边：

- `evaluateDiffGate` 步骤 3a 内部边：`mapperResult.freshness` → 出口 `{ reason, reason_code, retryable }` 分类。测试必须**真跑** `evaluateDiffGate` 本体，只允许注入 mapper 结果**数据**（`mapClient` 返回值）与 contract 行**数据**（`db.query` 返回 rows）；**禁止** `vi.mock` / stub 掉 `evaluateDiffGate` 自身或 3a 分支逻辑。
- 合法外层边界（允许注入，非本单被改边）：`mapClient`（另一服务的 HTTP 客户端，既有单测策略即注入）、`db`（步骤 3a 在任何 DB 写入前 `return`，改动路径**不触达** DB 写路径，故 db 用返回 contract 行的 stub 即可，无需真 Postgres）。
- diff-gate → orchestrator loop（`retryable===false` 消费点 loop.js:1542）为既有已测行为，本单不改该消费逻辑。

---

## 真实调用方请求 shape

N/A —— 无设备/agent 调服务端；改动为 Brain 进程内函数分支。无第三方 API 调用。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）—— 被改边真跑，mapper/db 为合法外层边界注入而非顶替被改逻辑；无 `force_*`/假数据/dry-run。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 改动为纯 Brain 后端门禁**函数分支**：无新增 HTTP 端点、无 DB 副作用（步骤 3a 在任何 DB 写前返回）。故 oracle 为 node 直跑真实 `evaluateDiffGate`（L2：真代码真逻辑，仅注入 mapper 结果数据 + contract 行数据这一合法外层边界）+ vitest 回归，**无需真 Postgres**（runtime postgres=false 一致）。psql/curl 对本改动路径 N/A（无 DB 写、无端点）。
> vitest 工作目录死规则（9.25.0）：包内 `packages/brain/src/**` 测试必须 `(cd packages/brain && npx vitest ...)` 子 shell 跑；sprints/** 合同测试才允许从仓库根跑。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# ── Layer 1：直接对真实 evaluateDiffGate 断言出口对象（终态 + 瞬态 + 兜底，真跑改动后的 3a）──
node --input-type=module -e "
import { evaluateDiffGate } from './packages/brain/src/impact-contract/diff-gate.js';
const db = { query: async () => ({ rows: [{ id: 'c', repo: 'cecelia', base_revision: 'base', contract_body: { affected_capabilities: [], required_assertions: [] } }] }) };
const mk = (freshness) => async () => ({ manifest_digest: 'm', projection_digest: 'p', fact_revisions: { cecelia: 'base' }, affected_nodes: [], required_assertions: [], freshness });
const term = await evaluateDiffGate({ db, taskId: 't', repo: 'cecelia', headRevision: 'h', mapClient: mk({ status: 'unknown', reason_code: 'impact_anchor_missing' }) });
if (term.gate !== 'impact_unknown' || term.retryable !== false || term.reason_code !== 'impact_anchor_missing' || term.reason === 'mapper_stale') { console.error('FAIL terminal', JSON.stringify(term)); process.exit(1); }
const trans = await evaluateDiffGate({ db, taskId: 't', repo: 'cecelia', headRevision: 'h', mapClient: mk({ status: 'stale', reason_code: 'fact_snapshot_stale' }) });
if (trans.retryable !== true || trans.reason_code !== 'fact_snapshot_stale' || trans.reason === 'mapper_stale') { console.error('FAIL transient', JSON.stringify(trans)); process.exit(1); }
const bounded = await evaluateDiffGate({ db, taskId: 't', repo: 'cecelia', headRevision: 'h', mapClient: mk({ status: 'unknown', reason_code: null }) });
if (bounded.retryable !== false || bounded.reason_code !== null) { console.error('FAIL bounded', JSON.stringify(bounded)); process.exit(1); }
console.log('OK exit-object', JSON.stringify({ term, trans, bounded }));
"

# ── Layer 2：sprint 合同回归（仓库根 vitest include 覆盖 sprints/**）──
npx vitest run --no-cache sprints/08201509-kernel-767e73b2/tests/diff-gate-reason-code.test.js

# ── Layer 3：包内永久回归（9.25.0：packages/brain/src 测试必须 cd 进包根跑）──
( cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js )

echo "OK Golden Path 验证通过：reason_code 透传 + 终态 fail-closed"
```

**通过标准**: 脚本 exit 0（三层全绿）。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 3a 终态 fail-closed | `sprints/08201509-kernel-767e73b2/tests/diff-gate-reason-code.test.js` | 确定性终态 unknown / 瞬态 stale / reason_code 缺失兜底 / revision_mismatch 出口语义不回退 | 现状 3a 一律 `reason:'mapper_stale',retryable:true` 无 reason_code → 前 3 用例 FAIL（实测 3 failed \| 1 passed）|
| 包内永久回归 | `packages/brain/src/impact-contract/__tests__/diff-gate.test.js` | generator 新增：终态 retryable:false 透传 / 瞬态 retryable:true 透传 / 缺失兜底 | 新增断言在改动前 FAIL |

> Test Contract 表「BEHAVIOR 覆盖」列每个覆盖名均为对应 `test()` 名的字面子串（`grep -F` 可命中）。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本 sprint 为纯分支逻辑，风险面窄）
高风险面:
- 错输入: `mapClient` 返回 `freshness` 缺失 / `freshness={}` / `freshness.status` 为未知第四值（如 `'weird'`）→ 期望仍 fail-closed（retryable:false），不崩溃、不误判 fresh
- 重复提交: 同一 taskId 连续两次调 `evaluateDiffGate`（非 fresh）→ 期望幂等，出口一致，无副作用累积
- 中途中断: N/A（纯同步判断，无中途状态）
- 边界值: `freshness.reason_code` 为空串 `''` / 非字符串（数字/对象）→ 期望透传或兜底不崩溃；`status='stale'` 但 `reason_code=null` → retryable:true 且 reason_code=null
发现分级: P0/P1（误判终态为瞬态致无限重试 / 崩溃 / 误判 fresh 假绿）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
