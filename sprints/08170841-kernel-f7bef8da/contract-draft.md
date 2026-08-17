# Sprint Contract Draft (Round 1) — Diff Impact Gate 确定性结论透传 reason_code 并 fail-closed 出口

**journey_type**: autonomous
**target_environment**: local_api
**contract-gate**: skipped 判定 — packages/brain/src/lib/contract-gate.js 存在则按代码层 Gate；本仓为 cecelia，Gate 生效（非第三方 repo）。

## Response Schema（推导来源: PRD 字面 — 无 HTTP 响应）

N/A — 任务无 HTTP 响应。本单为纯内部 kernel/orchestrator 改动：
`evaluateDiffGate` 返回值、`gateReceipt` 收据形状、`derive` 下一动作、`orchestrator_decision_log` 行。
无新增/变更 HTTP 端点。Reviewer 第 6 维按内部函数契约 + DB 写路径 oracle 审查。

被改函数的返回契约（内部 SSOT，非 HTTP）：
- `evaluateDiffGate(...)` 确定性 blocked：`{ gate:'blocked', reason:<reason_code>, retryable:false, detail:{ unclaimed_files:[...], capability_ids:[...] } }`
- `evaluateDiffGate(...)` 真新鲜度：`{ gate:'impact_unknown', reason:'mapper_stale', retryable:true }`
- `evaluateDiffGate(...)` 未知/畸形：`{ gate:'impact_unknown', reason:'mapper_contract_invalid', retryable:false }`
- **禁用字段名**：`reason` 不得把确定性 reason_code 折叠成 `mapper_stale`；`retryable` 对确定性结论不得为 `true`。

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/impact-contract/__tests__/diff-gate.test.js] → 现有：pass/extend/drift 裁决、Mapper 异常 fail-closed（impact_unknown）。本单新增分类分支不得回退这些既有断言。
- [packages/brain/src/map/radius.test.js] → graph_projection_revision_mismatch(status:unknown)、capability_not_in_active_projection(status:unknown) 已有断言；radius 本单不改，结论正确。
- [累积FR] （本 line 暂无历史 — context-manifest：本 sprint journey_id=e6f803f2，line 无历史 FR）
- must_run_assertions（Unified Map radius）：[MAP_NOT_CONFIGURED] — task.payload.map_scope=["F1"] 但 map_repo=null（半径需 scope+repo 二者齐备），跳过 Unified Map 半径，不回退领域硬编码。

## 历史约束三源加载

1. **铁律 → INV 覆盖**（见 contract-dod.md INV 段，逐条映射或 N/A）：
   - [Kernel evaluator clock] validation_clock_required 默认 fail-closed — 本单不触及 validation clock 注入路径 → N/A（改动仅在 impact 闸分类/路由，不改时钟）。
   - [generator retry identity] 基础设施失败重试原始派发动作 — 本单把确定性 impact 从「infrastructure_blocked 退避」剥离，**不改** infrastructure_blocked 的重试语义（仅对 retryable:false 确定性结论改走确定性出口）→ INV 断言：真新鲜度/基础设施类仍 retryable=true 走原退避（regression 测试保护）。
   - [planner role branch] / [Fleet Brain URL] — 本单不触及 planner 分支与 Brain URL 预检 → N/A。
2. **累积 FR（context-manifest）**：本 line 无历史 FR（见上）。
3. **回归测试约束**：见上「已知约束」。

## 锚定父路声明

独立小路（无父路）—— PrepPRD 未锚定 golden_path step（journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29，step_id=none）。本单是 Harness 内部稳固性修复，无面向用户业务父路。

## Golden Path

[Generator 已产出本地候选] → [Diff Impact Gate 按 reason_code 分类] → [确定性结论 fail-closed 出口 + decision-log 留痕] → [derive 路由 generator-fix / human_review]

### Step 1: Diff Impact Gate 按 reason_code 三分类
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步 + 「修法 A」（diff-gate.js 三类分流）。

**可观测行为**: `evaluateDiffGate` 消费 `mapperResult.freshness.reason_code`，快照新鲜与否不再是唯一判据：
- (a) 真新鲜度 reason_code（fact_snapshot_stale / projection_revision_missing / projection_revision_mismatch / manifest_projection_mismatch / graph_projection_revision_mismatch）→ `impact_unknown` / `mapper_stale` / `retryable:true`。
- (b) 确定性 reason_code（impact_anchor_missing / capability_assertion_coverage_missing / capability_not_in_active_projection / unsafe_assertion_ref / assertion_identity_ambiguous）→ `blocked` / `reason:<reason_code>` / `retryable:false` + `detail{unclaimed_files, capability_ids}`。
- (c) 其余未知 reason_code 或 freshness 缺失/畸形 → `impact_unknown` / `mapper_contract_invalid` / `retryable:false`。
- 分类必须按 **reason_code** 而非 status（graph_projection_revision_mismatch 的 status 是 unknown 却属真新鲜度组）。

**验证命令**:
```bash
npx vitest run sprints/08170841-kernel-f7bef8da/tests/diff-gate-reason-code.test.js
# 期望：exit 0（8 个 it 全绿）
```
**硬阈值**: 8 类 reason_code 分类断言全过；确定性结论 retryable 恒为 false。

---

### Step 2: harness-gates gateReceipt 透传 detail
**来源**: `[FROM_PRD]` — PRD「修法 B」harness-gates.js beforeEvaluate gateReceipt 透传 reason/retryable/detail。

**可观测行为**: `gateReceipt('diff', result)` 在原有 reason/retryable 基础上，新增透传 `result.detail`（确定性 blocked 的 unclaimed_files / capability_ids）；`gateReceipt` 从 harness-gates.js 导出以供单测与 E2E 复用。

**验证命令**:
```bash
npx vitest run sprints/08170841-kernel-f7bef8da/tests/harness-gates-receipt.test.js
# 期望：exit 0
```
**硬阈值**: blocked 收据含 detail.unclaimed_files / detail.capability_ids；pass 收据 detail 为 null 不崩。

---

### Step 3: derive 对 retryable:false 确定性 impact 路由确定性出口
**来源**: `[FROM_PRD]` — PRD「修法 B/C」loop.js 不退避重试 + derive 路由 generator-fix / human_review。

**可观测行为**: derive 读 decisionLog 里 `detail.impact_gate.retryable===false` 的 blocked 收据：
- reason=impact_anchor_missing 且未修过 → `spawn:generator-fix`（detail 携 unclaimed_files）。
- reason=capability_assertion_coverage_missing → `wait:human_review`。
- impact_anchor_missing 已 generator-fix 一次仍 blocked → `wait:human_review`（不无限修）。
loop.js 对 retryable:false 的 impact 结论 failure_class=impact_contract_invalid，不再进 infrastructure_blocked 退避；`DETERMINISTIC_IMPACT_ERROR_CODES` 补齐上述确定性 reason。

**验证命令**:
```bash
npx vitest run sprints/08170841-kernel-f7bef8da/tests/impact-routing-derive.test.js
# 期望：exit 0（4 个 it 全绿）
```
**硬阈值**: 三条路由动作精确匹配；不再返回 spawn:evaluator 无限重试。

---

### Step 4: 确定性 blocked 落 orchestrator_decision_log（可观测出口）
**来源**: `[FROM_PRD]` — PRD「可观测结果」orchestrator_decision_log 新增行 gate_verdict + detail.impact_gate。

**可观测行为**: 真 evaluateDiffGate → 真 gateReceipt → 真 appendHop 写入 orchestrator_decision_log：
`gate_verdict='deny:impact:impact_anchor_missing'`、`detail.impact_gate.retryable=false`、`detail.impact_gate.detail.unclaimed_files` 非空。

**验证命令**: 见 `## E2E 验收`（scratch 库 psql 时间窗断言）。
**硬阈值**: 5 分钟内新增 ≥1 行，字段齐全。

---

### Step 5: Brain semver 四处同步 + DevGate 三项
**来源**: `[FROM_PRD]` — PRD「NFR 约束」版本要求。

**可观测行为**: packages/brain/package.json / package-lock.json / .brain-versions / DEFINITION.md 四处版本一致 bump；facts-check / check-version-sync / check-dod-mapping 三项通过。

**验证命令**:
```bash
bash scripts/check-version-sync.sh && node scripts/facts-check.mjs && node packages/quality/scripts/devgate/check-dod-mapping.cjs
# 期望：exit 0
```
**硬阈值**: 三 DevGate 全过，四处版本字面相等。

---

## 真实调用方请求 shape

N/A — 本单无「设备/agent 调服务端」真实调用方。改动全在 kernel 内部函数间数据传递（radius→diff-gate→gateReceipt→loop→derive）与 DB 写路径，无外部 HTTP 调用方 shape 需对齐。

## 禁 mock 边清单

本单涉及「跨模块数据传递」（radius→diff-gate freshness 契约、diff-gate→loop/derive 收据）与「DB 写路径」（orchestrator_decision_log），故：

- **diff-gate.js ↔ radius/mapper freshness 契约**（本单改 diff-gate 对 mapperResult.freshness.reason_code 的分类消费）：单测**真调 evaluateDiffGate**（不 mock 被改的 diff-gate 自身）；上游 radius/mapper 需 Postgres+投影，单元层注入**录制/构造的 mapper 输出**（radius.js 本单不变，其输出形状为 SSOT）。真实 radius 输出边由 regression 录制件（regression-d1360a48-*.test.js，喂生产复现的真实 radius 结论）覆盖。
- **diff-gate/gateReceipt ↔ derive 路由**（本单改 retryable:false 的下一动作）：derive 为纯函数，单测**真调 derive(observed)**，不 mock derive。
- **代码 ↔ orchestrator_decision_log（DB 写路径）**：Final E2E 用**真 Postgres + 真 appendHop** 验行落库（5 分钟时间窗），不 mock DB。

## 未覆盖真实链路清单

- **queryImpactRadius 真实投影链路**：`哪个点被顶替`—单测/E2E 未调 live `queryImpactRadius`（需 Postgres + 已投影的 Unified Map projection，attempt 空库/scratch 库无该投影）；`为什么`—radius.js 本单**不改**（结论正确，错在消费方），且投影 bootstrap 超出本 sprint 范围；`真验证补位`—用生产复现的真实 radius 输出录制件（fixtures/d1360a48-radius.json）喂真 evaluateDiffGate，覆盖「diff-gate 正确消费 radius 真实确定性输出」；Final E2E 覆盖真 diff-gate→真 appendHop→真 orchestrator_decision_log。
- **回归夹具非字节级抓包**：fixtures/d1360a48-radius.json 的 radius_response 字段值取自 PRD 陈述的真实观测（快照 fresh、unclaimed_files=[DoD.md]、reason_code=impact_anchor_missing），非生产 HTTP 字节级抓包重放；`补位`—值与 radius.js 输出契约逐字段一致，radius.test.js 保证 radius 产出形状不漂。
- **loop.js 整跳编排未在单测跑**：derive 路由以纯函数单测覆盖「下一动作」，loop.js 把 retryable:false 结论落库+不退避的整跳编排由 Final E2E（真 appendHop 落 decision-log）+ 现有 kernel pg-integration 回归覆盖；`补位`—Generator 实现阶段将永久回归复制到 packages/brain/src/**/__tests__/ 并纳入 brain-integration job。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## E2E 验收（Final E2E — evaluator 按 target_environment=local_api 跑；数据写入类 scratch 库）

> 真链路：真 evaluateDiffGate（本单改的分类）→ 真 gateReceipt（本单改的透传）→ 真 appendHop（真 Postgres 写 orchestrator_decision_log）。
> mapper 注入生产复现的确定性 radius 输出（radius 需投影，scratch 库无，见未覆盖清单）。
> Fleet 注入 attempt 级空库 DB_URL；脚本先跑仓库真实 migration，再驱动真实写路径。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
DRIVER="$(mktemp /tmp/impact-e2e-XXXXXX.mjs)"
cleanup() { rm -f "$DRIVER"; }
trap cleanup EXIT

cat > "$DRIVER" <<'NODE'
import { Pool } from 'pg';
import { runMigrations } from './packages/brain/src/migrate.js';
import { evaluateDiffGate } from './packages/brain/src/impact-contract/diff-gate.js';
import { gateReceipt } from './packages/brain/src/impact-contract/harness-gates.js';
import { appendHop } from './packages/brain/src/orchestrator/decision-log.js';

const pool = new Pool({ connectionString: process.env.DB_URL });
try {
  await runMigrations(pool);

  // 真 evaluateDiffGate：本单改的分类逻辑（db 省略 → 直接进 mapper 分类）
  const recordedRadius = async () => ({
    freshness: { status: 'unknown', reason_code: 'impact_anchor_missing' },
    fact_revisions: { cecelia: 'bc4e8644' },
    affected_nodes: [],
    required_assertions: [],
    unclaimed_files: ['DoD.md'],
  });
  const gateResult = await evaluateDiffGate({
    repo: 'cecelia',
    headRevision: 'a'.repeat(40),
    changedFiles: ['DoD.md'],
    mapClient: recordedRadius,
  });
  if (gateResult.gate !== 'blocked' || gateResult.retryable !== false) {
    throw new Error('E2E FAIL: diff-gate 未产出确定性 blocked/retryable=false: ' + JSON.stringify(gateResult));
  }

  // 真 gateReceipt：本单改的 detail 透传
  const receipt = gateReceipt('diff', gateResult);
  const gateVerdict = 'deny:impact:' + receipt.reason;

  // seed 一条 run（orchestrator_decision_log.run_id → initiative_runs.id）
  const seeded = await pool.query(
    `INSERT INTO initiative_runs
       (initiative_id, phase, orchestrator_version, created_source, record_trust_status,
        impact_contract_policy, impact_contract_policy_reason)
     VALUES (gen_random_uuid(), 'B_task_loop', 'v2', 'e2e-impact-gate', 'trusted',
        'required', 'impact-gate-e2e')
     RETURNING id`,
  );
  const runId = seeded.rows[0].id;

  // 真 appendHop：真 Postgres 写 orchestrator_decision_log（append-only 硬约束表）
  await appendHop(pool, {
    runId,
    hop: 1,
    observed: { note: 'impact-gate-e2e', trigger_sha: 'a'.repeat(40) },
    derivedPhase: 'evaluate',
    gateVerdict,
    action: 'spawn:evaluator',
    detail: { reason: 'contract_approved', impact_gate: receipt },
  });

  process.stdout.write('RUN_ID=' + runId + '\n');
} finally {
  await pool.end();
}
NODE

OUT="$(node "$DRIVER")"
echo "$OUT"
RUN_ID="$(echo "$OUT" | sed -n 's/^RUN_ID=//p')"
[ -n "$RUN_ID" ] || { echo "FAIL: 未取到 RUN_ID"; exit 1; }

# psql 断言：新增确定性 blocked 行，带 retryable=false + 非空 unclaimed_files + 5 分钟时间窗
CNT="$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$RUN_ID' AND gate_verdict='deny:impact:impact_anchor_missing' AND (detail->'impact_gate'->>'retryable')='false' AND jsonb_array_length(detail->'impact_gate'->'detail'->'unclaimed_files') >= 1 AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')"
[ "$CNT" -ge 1 ] || { echo "FAIL: orchestrator_decision_log 缺确定性 blocked 行 (count=$CNT)"; exit 1; }

echo "OK: Golden Path Final E2E 通过 run_id=$RUN_ID decision_log_rows=$CNT"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: mapper 返回 `freshness=null` 或 `freshness={}`（无 reason_code）→ 必须 fail-closed mapper_contract_invalid/retryable=false，不得崩溃或退回 retryable=true。
- 重复提交: 同一候选连续两跳都命中确定性 blocked → derive 第二跳不得再无限重派 spawn:evaluator（应已路由 generator-fix / human_review）。
- 中途中断: impact_anchor_missing 路由到 generator-fix 后候选仍含无主文件（generator 未删）→ 第二次 blocked 必须落 human_review，不得回退无限重试。
- 边界值: 同一候选同时"看似"命中多个语义（如 unclaimed_files 非空但 reason_code 是 capability_assertion_coverage_missing）→ 以 mapper 给的单一 reason_code 为准，确定性 > 真新鲜度优先级。
发现分级: P0/P1（确定性结论又被折叠成 retryable=true 无限重试 / decision-log 丢证据）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| diff-gate reason_code 分类 | `tests/diff-gate-reason-code.test.js` | impact_anchor_missing 返回 blocked、capability_assertion_coverage_missing 返回 blocked、fact_snapshot_stale 仍 impact_unknown、graph_projection_revision_mismatch 仍属真新鲜度、未知 reason_code 走 fail-closed、freshness 缺失 走 fail-closed | 现码 impact_unknown → 8 断言红 |
| gateReceipt 透传 | `tests/harness-gates-receipt.test.js` | 收据含 reason、收据透传 detail.capability_ids、pass 结果无 detail 时收据 detail 为 null | gateReceipt 未导出 → 红 |
| derive 确定性出口路由 | `tests/impact-routing-derive.test.js` | 下一动作 spawn:generator-fix、generator-fix 携带 unclaimed_files、wait:human_review、已 generator-fix 一次仍 blocked | 现码 spawn:evaluator → 4 断言红 |
| 回归 d1360a48 | `tests/regression-d1360a48-impact-anchor.test.js` | 新行为为 blocked | 现码 mapper_stale → 红 |
