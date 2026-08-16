# Sprint Contract Draft (Round 1) — Diff Impact Gate 透传 reason_code + fail-closed 出口

**锚定父路声明**: 独立小路（无父路）—— 本 sprint 是 kernel harness 内部闸修复，不推进任何业务 Golden Path。

gp-anchor: skipped (product-map.json not found)

contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），本合同断言按 Contract Gate 惯用法书写。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。改动为 **内部 gate 返回契约** + **orchestrator_decision_log JSON 落库契约**，二者是本单机器可检 oracle（详见 Golden Path Step 2/3）：

### 内部契约 1：evaluateDiffGate() 返回值（diff-gate.js）
确定性 blocked 分支必须返回：
```json
{"gate": "blocked", "reason": "<reason_code>", "retryable": false, "detail": {"unclaimed_files": ["..."], "uncovered_capability_ids": ["..."]}}
```
真新鲜度分支（回归保护）保持：
```json
{"gate": "impact_unknown", "reason": "mapper_stale", "retryable": true}
```
未知/畸形分支（fail-closed）：
```json
{"gate": "impact_unknown", "reason": "mapper_contract_invalid", "retryable": false}
```
- `gate` (string, 必填): `blocked` | `impact_unknown`（沿用现有枚举，不新增）
- `reason` (string, 必填): 确定性分支 = 原 reason_code 字面；真新鲜度 = `mapper_stale`；未知 = `mapper_contract_invalid`
- `retryable` (boolean, 必填): 确定性/未知 = `false`；真新鲜度 = `true`
- `detail` (object, 确定性 blocked 分支必填): `unclaimed_files` 数组 + `uncovered_capability_ids` 数组
**禁用字段名**: 不得把确定性结论标成 `mapper_stale`（这是把 fail-closed 折叠成可重试的根因，严禁）；不得新增 `gate` 枚举值。

### 内部契约 2：orchestrator_decision_log.detail.impact_gate（loop.js 落库）
```json
{"gate_verdict": "deny:impact:impact_anchor_missing", "detail": {"impact_gate": {"reason": "impact_anchor_missing", "retryable": false, "detail": {"unclaimed_files": ["DoD.md"]}}}}
```

---

## Golden Path

[Generator 已产出本地候选，进入 evaluator 前置 Diff Impact Gate] → [gate 按 mapper 返回的 reason_code 三分类判定] → [确定性结论 fail-closed 出口按 reason 路由 generator-fix / human_review，不再无限重试；真新鲜度问题仍可重试]

### Step 1: beforeEvaluate 触发 Diff Impact Gate，mapper 返回 freshness + reason_code
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步

**可观测行为**: harness-gates.beforeEvaluate 调 evaluateDiffGate；mapper（radius.js）在快照 fresh 前提下把确定性结论写进 `freshness.status='unknown'` + `reason_code`（`impact_anchor_missing` 含 `unclaimed_files`；`capability_assertion_coverage_missing` 含缺覆盖 capability）。radius.js 产方不动。

**验证命令**:
```bash
npx vitest run sprints/08161127-kernel-0bce0b07/tests/diff-gate-classification.test.ts --reporter=basic
# 期望：exit 0（7 用例全过）
```
**硬阈值**: 冻结测试 diff-gate-classification.test.ts 全绿（exit 0）

---

### Step 2: diff-gate.js 三分类（modification A）
**来源**: `[FROM_PRD]` — PRD「系统处理」(a)/(b)/(c) 三分类

**可观测行为**:
- (a) 真新鲜度（`fact_snapshot_stale` / `projection_revision_missing` / `projection_revision_mismatch` / `manifest_projection_mismatch` / `graph_projection_revision_mismatch`）→ `impact_unknown/mapper_stale/retryable:true`（回归保护）。
- (b) 确定性结论（`impact_anchor_missing` / `capability_assertion_coverage_missing` / `capability_not_in_active_projection` / `unsafe_assertion_ref` / `assertion_identity_ambiguous`）→ `blocked/reason:<原码>/retryable:false`，`detail` 带 `unclaimed_files` 与缺覆盖 `uncovered_capability_ids`。
- (c) 其余未知 reason_code、或 `freshness` 缺失/非 object → fail-closed `impact_unknown/mapper_contract_invalid/retryable:false`。

**验证命令**:
```bash
npx vitest run sprints/08161127-kernel-0bce0b07/tests/diff-gate-classification.test.ts sprints/08161127-kernel-0bce0b07/tests/diff-gate-regression-fixture.test.ts --reporter=basic
# 期望：exit 0
```
**硬阈值**: 两个冻结测试全绿（exit 0）

---

### Step 3: harness-gates 透传 + loop/derive 按 reason 路由（modification B）+ 落库可观测
**来源**: `[FROM_PRD]` — PRD「可观测结果」三条 + [AI_ADDED] 落库时间窗防造假（理由：防止历史 decision_log 行冒充本轮产出）

**可观测行为**:
- harness-gates.beforeEvaluate 的 gateReceipt 透传 `reason/retryable/detail`（旧 gateReceipt 丢 detail）。
- loop.js 对 `retryable:false` 的 impact 结论走既有确定性出口（`DETERMINISTIC_IMPACT_ERROR_CODES` 补齐上述 reason，`failure_class=impact_contract_invalid`），不再按 `infrastructure_blocked` 退避无限重试；由 derive 按 reason 二选一路由：`impact_anchor_missing` → `spawn:generator-fix`（detail 携 unclaimed_files）；`capability_assertion_coverage_missing` → `wait:human_review`。
- orchestrator_decision_log 落一行 `gate_verdict='deny:impact:impact_anchor_missing'`，`detail.impact_gate.retryable=false`，`detail.impact_gate.detail.unclaimed_files` 非空。

**验证命令**:
```bash
npx vitest run sprints/08161127-kernel-0bce0b07/tests/harness-gates-receipt.test.ts sprints/08161127-kernel-0bce0b07/tests/derive-impact-route.test.ts --reporter=basic
# 期望：exit 0（回执透传 + 路由二选一）
# 落库可观测由 ## E2E 验收 的 psql 断言在 scratch 库真验（L2）
```
**硬阈值**: 两个冻结测试全绿；Final E2E 落 deny 行（见 ## E2E 验收）

---

### Step 4: Brain semver 四处同步 + DevGate 三项
**来源**: `[FROM_PRD]` — PRD「范围限定：Brain semver 四处同步 + DevGate 三项」

**可观测行为**: package.json version bump（当前 1.273.59），四处同步；facts-check / check-version-sync / check-dod-mapping 三项通过。

**验证命令**:
```bash
bash scripts/check-version-sync.sh && node scripts/facts-check.mjs
# 期望：exit 0
```
**硬阈值**: 版本四处一致 + DevGate 三项 exit 0

---

## 已知约束

### 来自回归测试（Step 1.2）
- [diff-gate.js:12] fail-closed 原则：Mapper 任何不可判定情形均返回 blocked，绝不假绿 —— 本单强化：确定性不可判定必须 retryable:false，不得折叠成可重试的 mapper_stale。
- [diff-gate.js:202-208] 旧逻辑 `freshness.status !== 'fresh'` 一律 mapper_stale/retryable:true（被改点）。
- [radius.js:81-90] baseFreshness 产真新鲜度码（fact_snapshot_stale / projection_revision_missing / projection_revision_mismatch）—— 归 (a) 可重试。
- [radius.js:381-397] 快照 fresh 前提下写确定性结论码（capability_not_in_active_projection / impact_anchor_missing / unsafe_assertion_ref / assertion_identity_ambiguous / capability_assertion_coverage_missing）—— 归 (b) fail-closed。
- [loop.js:84-90] DETERMINISTIC_IMPACT_ERROR_CODES 现集合（impact_contract_schema_invalid 等）→ 补入本单 reason。
- [loop.js:1535-1547] gateVerdict deny 时 `retryable===false → failure_class='impact_contract_invalid'`（现成路由基座，本单让 receipt 真带 retryable:false）。

### 来自累积 FR（context-manifest）
- 本 line 暂无历史（PRD「累积 FR」段）。context-manifest: not queried（proposer 环境 postgres:false，PRD 已声明本 line 无历史，无回退风险）。

### must_run_assertions（Unified Map radius）
- [MAP_NOT_CONFIGURED] —— task.payload 未提供 map_scope/map_repo（proposer 环境无 Brain 5221 / postgres），按 skill 规则明确标注，不回退领域硬编码。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | diff-gate 按 mapper reason_code 三分类；确定性结论 fail-closed（retryable:false）+ 透传 detail；loop/derive 按 reason 路由 generator-fix / human_review |
| **NFR（做得多好）** | 非功能 | 不改 kernel 90s 重试节奏，只改「是否重试」判定；确定性结论必须写入 orchestrator_decision_log |
| **Invariant（永不违反）** | 铁律 | ①未知/不可判定 mapper 结论一律 fail-closed（禁标可重试导致无限空转）②radius.js/map-client.js assertMapperContract 产方不动 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | reason_code 集合与 radius.js 产方语义绑定；radius.js 新增确定性码时须同步扩 diff-gate (b) 集合，否则 (c) fail-closed 兜底（安全侧） |
| **死亡告警（停了谁知道）** | 告警 | 确定性结论落 orchestrator_decision_log + run 走确定性出口（generator-fix/human_review），不再静默空转到 deadline；运维从 decision_log 的 gate_verdict + detail.impact_gate 判因 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | Final E2E psql 查 orchestrator_decision_log 真实落行（时间窗 5min），非仅测试自断言 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ mapper 结论是「真新鲜度问题（可重试）」还是「确定性结论（fail-closed）」 | A. 只看 freshness.status（stale vs unknown）; B. 按 freshness.reason_code 归属集合分类 | B（reason_code 归属集合，status 仅辅助） | reason_code 是 radius 产方语义 SSOT，比 status 粒度稳；未来新增码走 (c) fail-closed 兜底 | 误判确定性为可重试 → kernel 无限空转到 deadline（本单根因）；误判可重试为确定性 → 真新鲜度抖动被过早 fail-closed |
| impact_anchor_missing 该 generator-fix 还是 human_review | A. 一律 human_review; B. 先 generator-fix 一次（候选可自修：删/挪无主文件），仍失败转 human_review | B | 无主文件常是候选新建的可自修文件（如 DoD.md），先给一次自修更省人力 | 误判：可自修的当 human_review → 浪费人力；不可自修的死循环 generator-fix → 由 no-progress 护栏兜底转 human_review |

> ⚠️ 行属「升拍板点主动请教用户」级别；本单判定点已由 PRD 显式拍定（PRD「系统处理」段逐条列出分类与路由），无待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写 DB | 是（幂等键=task_id） | 客户端重试 |
| mapper 返回未知 reason_code | fail-closed → impact_unknown/mapper_contract_invalid/retryable:false | 是（纯函数按 reason_code 判定，无副作用） | 走确定性出口（human_review），不静默放行、不无限重试 |
| mapper freshness 缺失/非 object | 同上 fail-closed mapper_contract_invalid/retryable:false | 是 | 同上 |
| 真新鲜度问题（fact_snapshot_stale 等） | impact_unknown/mapper_stale/retryable:true | 是 | 保留可重试，由 run deadline 收敛（现有行为，回归保护） |

### 输入对抗面
N/A — 本单为 kernel 内部闸逻辑，输入来自内部 mapper（radius.js）返回值，无对外暴露 agent 写入面。

---

## 禁 mock 边清单

本单改动涉及「状态机/跨模块数据传递/生命周期钩子」（diff-gate 分类 → harness-gates 回执 → loop/derive 路由 → decision_log 落库），逐条列被改的边：

- **diff-gate.js（分类逻辑）↔ mapper 返回值**：分类逻辑本身**不 mock**（冻结单测真跑 evaluateDiffGate 分类分支）；仅注入 mapper 的**返回值录制**（radius.js 是明确的产方边界、本单不改、PRD 划为不做项）——注入的是被消费的数据，不是被改的逻辑。
- **harness-gates.beforeEvaluate（gateReceipt 组装）↔ diff-gate 结果**：两侧都改。冻结单测 harness-gates-receipt 注入 diff-gate 返回值以隔离验证 gateReceipt 透传；**该改动边的真实拼接（真 diff-gate + 真 gateReceipt + 真 loop append + 真 Postgres）由 ## E2E 验收 在 scratch 库全链路不 mock 验证**（L2）。
- **loop.js/derive ↔ orchestrator_decision_log（DB 写路径）**：derive 冻结单测用**真 derive**（纯函数）+ 按 loop.js append 真实落库形态构造 decisionLog 行，不 mock derive；**loop append → 真 Postgres 落 orchestrator_decision_log 由 ## E2E 验收 不 mock 真验**（真库真行 psql 复核，时间窗防造假）。

> 死规则遵循：被改的接缝（diff-gate↔harness-gates↔loop↔DB）在 Final E2E 以真 Postgres + 真相邻模块全链路验证，不 mock 被改的边；单测的注入仅在产方边界（radius 返回值）与为隔离子行为，且每条被改边均有一个不 mock 的 Final E2E 覆盖。需真 PG 的测试放 `packages/brain/src/__tests__/integration/*.pg.integration.test.js`，由 brain-integration job 起真 Postgres 跑。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapper 返回 `freshness` 为 `null` / 字符串 / 数组（非 object）→ 必须 (c) fail-closed mapper_contract_invalid/retryable:false，不得抛异常崩溃。
- 错输入: mapper 返回确定性 reason_code 但 `unclaimed_files` 字段缺失 → detail.unclaimed_files 应为 `[]`（空数组，非 undefined），仍 blocked。
- 边界值: reason_code 为空串 `''` 或 `null`（status 非 fresh）→ 走 (c) fail-closed，不得误进 (a) mapper_stale。
- 重复提交: 同一 run 连续两次撞 impact_anchor_missing → 第一次 generator-fix、第二次由 no-progress/K4 护栏转 human_review，不得无限 generator-fix。
- 中途中断: 确定性 blocked 落库后 kernel 重启重观测 → derive 从 decision_log 幂等重算路由，不重复派发。
发现分级: P0/P1（回退无限重试 / 确定性结论被误标可重试 / fail-closed 崩溃）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> autonomous + local_api：curl/psql 全程链路，本地执行。本单核心可观测 = orchestrator_decision_log 真实落一行确定性 deny。
> DB_URL 由 Fleet 注入 attempt 级空库；本单 Brain 经 db-config.js 读 DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD（**不读连接串**），故脚本先把 DB_URL 解成 DB_* 分量，psql 直接用 DB_URL。
> 真实副作用由 Generator 落库的 PG 集成测试 `impact-gate-deterministic-route.pg.integration.test.js` 驱动一次真实 orchestrator hop（注入 mapper 返回 impact_anchor_missing，真 append 落 orchestrator_decision_log），再由本脚本 psql 独立复核落行（两独立 oracle：vitest + psql）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"

# 0. 把 DB_URL 解成 brain db-config 需要的 DB_* 分量（brain 不读连接串）
proto_removed="${DB_URL#*://}"
creds_host="${proto_removed%%/*}"
db_and_query="${proto_removed##*/}"
userpass="${creds_host%@*}"
hostport="${creds_host##*@}"
export DB_USER="${userpass%%:*}"
export DB_PASSWORD="${userpass#*:}"
export DB_HOST="${hostport%%:*}"
export DB_PORT="${hostport##*:}"
DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${db_and_query%%\?*}"
export NODE_ENV=test

# 1. 空库 bootstrap：跑仓库真实 migration，机检目标表存在
node packages/brain/src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t || { echo "FAIL: orchestrator_decision_log 未建"; exit 1; }

# 2. 记录脚本启动时间锚（时间窗防造假由 psql created_at > NOW()-5min 兜底）
# 3. 驱动一次真实 orchestrator hop：注入 mapper 返回 impact_anchor_missing，真 append 落库（不 mock 被改的边）
BRAIN_TEST_DATABASE_URL="$DB_URL" DATABASE_URL="$DB_URL" \
  npx vitest run packages/brain/src/__tests__/integration/impact-gate-deterministic-route.pg.integration.test.js --reporter=basic || { echo "FAIL: PG 集成驱动失败"; exit 1; }

# 4. psql 独立复核 orchestrator_decision_log 真实落了确定性 deny 行（时间窗 5min 防历史数据冒充）
ROW=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE gate_verdict = 'deny:impact:impact_anchor_missing' AND (detail->'impact_gate'->>'retryable') = 'false' AND jsonb_array_length(COALESCE(detail->'impact_gate'->'detail'->'unclaimed_files', '[]'::jsonb)) >= 1 AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$ROW" -ge 1 ] || { echo "FAIL: orchestrator_decision_log 无确定性 deny 行（gate_verdict/retryable/unclaimed_files 三条件）"; exit 1; }

# 5. 回归复核：真新鲜度问题仍落 mapper_stale 语义（retryable=true），未被误判 blocked
STALE=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE gate_verdict = 'deny:impact:impact_anchor_missing' AND (detail->'impact_gate'->>'retryable') = 'true'" | tr -d ' ')
[ "$STALE" = "0" ] || { echo "FAIL: 确定性结论被误标 retryable=true"; exit 1; }

echo "✅ Final E2E: orchestrator_decision_log 落 deny:impact:impact_anchor_missing retryable=false unclaimed_files 非空，确定性结论未被误标可重试"
```

**通过标准**: 脚本 exit 0（迁移建表 + PG 集成驱动 + psql 独立复核确定性 deny 行 + 回归复核）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate 三分类 | `tests/diff-gate-classification.test.ts` | `impact_anchor_missing 返回 blocked`；`capability_assertion_coverage_missing 返回 blocked`；`unsafe_assertion_ref 返回 blocked`；`fact_snapshot_stale 仍 impact_unknown`；`projection_revision_mismatch 仍 impact_unknown`；`未知 reason_code 归 impact_unknown/mapper_contract_invalid`；`freshness 缺失/非 object 归 impact_unknown/mapper_contract_invalid` | 5 failed / 2 passed（回归保护 2 条现绿）|
| 回归夹具 d1360a48 | `tests/diff-gate-regression-fixture.test.ts` | `真实录制件 → blocked:impact_anchor_missing` | 1 failed |
| harness-gates 回执透传 | `tests/harness-gates-receipt.test.ts` | `blocked:impact_anchor_missing 结果 → 回执含 reason/retryable=false/detail.unclaimed_files`；`pass 结果的回执 retryable 默认 false` | 1 failed / 1 passed |
| derive 按 reason 路由 | `tests/derive-impact-route.test.ts` | `impact_anchor_missing（retryable=false）→ 下一动作 spawn:generator-fix`；`capability_assertion_coverage_missing（retryable=false）→ 下一动作 wait:human_review` | 2 failed |

> BEHAVIOR 覆盖名均为对应 it() 测试名的字面子串。

---

## 未覆盖真实链路清单（mock 豁免显式登记 — 规则 C）

| 被 mock 顶替的真实链路点 | 为什么 | 真验证补位计划 |
|---|---|---|
| radius.js 真实「从无主文件/缺断言算出 reason_code」的产方计算 | radius.js 是产方、PRD 划为不做项（不改产方）；本单只改**消费方**分类。让 radius 在 scratch 空库自然产出 impact_anchor_missing 需真实 Map manifest + 无主文件种子，超出本单范围 | 冻结单测与 Final E2E 均注入 mapper 的**返回值录制/桩**（radius 产方边界），被改的消费方分类逻辑真跑；radius 产方语义由其自有 __tests__ 守护（本单不动） |
| diff-gate↔harness-gates↔loop→orchestrator_decision_log 真实拼接 | 冻结单测为隔离子行为在模块边界注入返回值 | **Final E2E（## E2E 验收）在 scratch 真 Postgres 上真 append 真落行 psql 复核，不 mock 被改的边**（禁 mock 边清单第 2/3 条对应的真验补位）|

> 本清单由 harness-controller 呈现进 PR 描述，不静默。被改的消费方逻辑与落库接缝均有一个不 mock 的 Final E2E 覆盖。

## notes

- contract-gate: cecelia worktree（gate 文件存在），断言按惯用法速查表书写（curl -f / psql 时间窗 / 无 `|| true` 吞错）。
- Kernel validation identity: 本合同不写任何 attempt/account/snapshot UUID 字面值；E2E 身份由 Runner 注入的 DB_URL / HARNESS_* late-bind（本单无需 HARNESS_* 断言，纯 DB 落行复核）。
- r2 硬要求已满足：合同冻结测试全部落 `sprints/08161127-kernel-0bce0b07/tests/`；永久回归测试（含 PG 集成 `impact-gate-deterministic-route.pg.integration.test.js`）由 Generator 实现阶段落 `packages/brain/src/**/__tests__/`。
