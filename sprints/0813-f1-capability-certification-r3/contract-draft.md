# Sprint Contract Draft (Round 1)

**Sprint**: F1 Capability 可重复认证闭环 kernel-v1（20260813-r3）
**journey_type**: autonomous
**target_environment**: local_api
**map_radius**: `[MAP_NOT_CONFIGURED]` — task.payload.map_scope / map_repo 均为 null（curl 实测），无法生成 Unified Map 影响半径；`must_run_assertions` 为空，按 PRD + 现有 Mapper/receipt 代码约定推导，禁止回退领域硬编码。
**contract-gate**: `packages/brain/src/lib/contract-gate.js` 存在（cecelia worktree）→ 代码层 Contract Gate 生效，本合同断言按速查表写成 gate-clean。
**gp-anchor**: skipped (product-map.json not found) — 本仓（cecelia）根目录无 `product-map/generated/product-map.json`，GP-Anchor 段整体跳过。

## 冻结身份（task_bundle SSOT — 跨角色与 GAN 轮次不变，可硬编码）

> 以下是运行开始前已冻结的稳定对象（PRD 假设 + `GET /api/brain/golden-paths/8943227f-.../contracts` 实测确认 content_hash 相符、status=signed）。可在合同/测试里字面固定。**禁止**把任何角色的 attempt_id / account / capability_snapshot_id 当作认证身份写死——那些必须 late-bound（见下）。

| 身份 | 值 | 来源核实 |
|---|---|---|
| journey_id | `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` | task.payload.anchor.journey_id |
| anchor.gp_id | `8943227f-20dd-4c54-ad06-d12e6ed2e705` | task.payload.anchor.gp_id |
| anchor.step_id | `aad25bdb-bdd6-47f4-9a99-e1176e23ac8b` | task.payload.anchor.step_id |
| gp_contract_id | `48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3` | golden_path_contract_versions.id（实测存在）|
| gp_contract_version | `1` | 实测 version=1 |
| gp_contract_hash | `3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8` | 实测 content_hash，status=signed |
| capability | `F1` | 本轮认证目标 |

**Late-bound（禁止写死 UUID 字面值）**：Evaluator/Judge 运行时身份从 Runner 注入的 `HARNESS_ATTEMPT_ID` / `HARNESS_MACHINE` / `HARNESS_ACCOUNT` / `CAPABILITY_SNAPSHOT_ID` 读取；受测 receipt 的 `machine_id` / `harness_attempt_id` 来自被测 Evaluator attempt，不由本合同固定。

## 锚定父路声明

覆盖父路 gp `8943227f-20dd-4c54-ad06-d12e6ed2e705`（journey `e6f803f2` — F1 可重复认证 Golden Path）第 1-4 步（PRD Golden Path 具体 1~4：冻结身份开工 → Evaluator receipt 落账 → Mapper fail-closed 聚合 → 非 synthetic PASS receipt + Mapper 结论回读）。

## Response Schema（推导来源: [NEW_PATTERN]，字段命名对齐现有 `map/state-resolver.js` 返回 `state`/`reason_code` + `journey_assertion_receipts` 列名；PRD 未定义 HTTP schema）

### Endpoint: `GET /api/brain/capabilities/:capability/certification`

复用现有 `analytics.js` 的 `/capabilities` 路由族（**不新增平行认证系统**），内部复用 `map/state-resolver.js` 的 `resolveNodeState`/`aggregateCapabilityState` + `impact-contract/harness-gates.js` 的 `verifyImpactMergeFence` 语义 + `journey_assertion_receipts` 读路径。

**Query 参数（必填）**: `gp_contract_id`, `gp_contract_version`, `gp_contract_hash`, `journey_id`, `step_id`；可选 `expected_merge_sha`（缺省时取受测 impact/gp 合同 head_revision）。

**Success (HTTP 200)**:
```json
{
  "capability": "F1",
  "state": "green",
  "gp_contract_id": "48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3",
  "gp_contract_version": 1,
  "gp_contract_hash": "3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8",
  "journey_id": "e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29",
  "step_id": "aad25bdb-bdd6-47f4-9a99-e1176e23ac8b",
  "receipt_id": "<uuid|null>",
  "synthetic": false,
  "merge_sha": "<40-hex|null>",
  "reason_code": "pass_current_revision"
}
```
- `capability` (string, 必填): 字面 `"F1"`。
- `state` (string, 必填): `green` / `red` / `gray` / `unknown` — 复用 `resolveNodeState` 枚举。**green 仅当**冻结身份齐 + 当前 revision 有非 synthetic PASS receipt。
- `gp_contract_id` / `gp_contract_version` / `gp_contract_hash` (必填): 回显所认证的**冻结**身份，用于证明未按 Journey 猜最新 GP。
- `receipt_id` (uuid|null, 必填): 判 green 所依据的那条 `journey_assertion_receipts.id`；非 green 时可为 null。
- `synthetic` (boolean, 必填): 恒 `false`（DB 层 `CHECK (synthetic = false)` 兜底；green receipt 必非 synthetic）。
- `reason_code` (string, 必填): `pass_current_revision`（green）/ `no_receipt`（gray，无 receipt）/ `revision_mismatch`（unknown，错 SHA）/ `anchor_target_missing`（gray，缺 Feature 绑定）/ `contract_identity_mismatch`（gray，无/错合同）/ `receipt_fail`（red，receipt FAIL）。
- `merge_sha` (40-hex|null, 必填): green 依据 receipt 的 `source_sha`。

**禁用字段名**（gate + reviewer 反向核查，正向断言里绝不出现）: `verdict`（receipt 级，非 capability 级）、`passed`、`ok`、`status`（node 级歧义，capability 结论统一用 `state`）、`result`。

**Error (HTTP 400)**（缺必填 query）:
```json
{"error": "<string>"}
```

## 已知约束（回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/impact-contract/__tests__/assertion-receipts.test.js` → receipt 身份不全（缺 source_sha / contract_id / contract_hash / machine_id）必抛 `evidenceError`，PASS 落账为 bijection（checks 与 required_assertions 一一对应）。**本 sprint 不得放宽**。
- [回归测试] `packages/brain/src/__tests__/integration/migration-374-gp-assertion-receipts.integration.test.js` → `journey_assertion_receipts` append-only（UPDATE/DELETE 触发器拦截）、`synthetic` 只能 false、PASS 需 exit_code=0 + source_sha 40hex + machine_id + output_digest 64hex + scenario_count>0 + scenario_evidence≠`{}`。**本 sprint 复用不得绕过**。
- [回归测试] `packages/brain/src/impact-contract/__tests__/gap-receipt-trust.test.js` → synthetic receipt 不被信任聚合。
- [累积FR] `GET /api/brain/line/e6f803f2.../context-manifest`：实测返回空（journey e6f803f2 现有 golden_path 均 planned，无已验收历史 FR）→ 无既有行为需保护，标 `context-manifest: empty`。
- [铁律] 见下方 `## 八要素需求规范` 的 Invariant 行与 DoD 的 INV-1/INV-2 条目。

## 禁 mock 边清单

本单改动涉及 **DB 写路径**（`journey_assertion_receipts` 落账）+ **状态机/聚合**（Mapper fail-closed 结论）+ **跨模块数据传递**（task_bundle 冻结身份贯穿 Evaluator→receipt→Mapper），故 failing test 与 nightly 负向矩阵必须**不 mock 被改的边**：

- 代码 ↔ DB 表 `journey_assertion_receipts`（本单精确落账 + 读回聚合，测试必须真 Postgres 验行落库与 CHECK 约束，禁 `vi.mock('pg')` / stub `db.query`）
- 代码 ↔ DB 表 `golden_path_contract_versions`（冻结身份校验必须真查 content_hash/status，禁 mock）
- 代码 ↔ DB 表 `journey_step_links` / `journey_features`（Feature 绑定与 anchor 目标存在性必须真查，缺 Feature 走真 NULL 路径，禁 mock）
- `map/state-resolver.js` ↔ `journey_assertion_receipts`（Mapper 聚合与 receipt 选择必须真库真行，禁 mock receipt 选择器）
- 允许 mock 的更外层无关依赖：Notion/Bark 通知、GitHub PR API（本 sprint 不触碰其真实响应正确性）。

nightly 负向矩阵测试放 `packages/brain/src/__tests__/integration/f1-capability-certification.integration.test.js`（真 PG，由 `integration-nightly.yml` 起 postgres service 跑）；PR-CI smoke 放 `sprints/0813-f1-capability-certification-r3/tests/*.test.ts`（`harness-v5-checks.yml` 的 `tests-actually-pass` job 起真 postgres + Brain server 跑）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 在冻结 GP Contract 身份下，跑通 Generator→Evaluator→Judge→PR→Receipt→Mapper 闭环，产出 F1 的**同一 Task/Run/Impact Contract/GP Contract/merge SHA** 下一条非 synthetic PASS receipt，并经新 `GET /capabilities/F1/certification` 回读 Mapper 结论 green。 |
| **NFR（做得多好）** | | 超时沿用 Kernel Harness 现值（PrepPRD 未指定）；版本要求 Brain ≥ 1.272.36（含 PR #4859）。 |
| **Invariant（永不违反）** | | ① `journey_assertion_receipts` append-only 且 `synthetic=false` 恒真（DB CHECK）；② green 结论必须由当前 revision 的非 synthetic PASS receipt 支撑，无 receipt/错 SHA/缺 Feature/缺合同一律 **not green**（fail-closed）；③ 冻结 GP Contract 本体（v1、hash 固定）不可变更。 |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | receipt 的有效性绑定 `assertion_revision` + `source_sha`；assertion 变更 → revision bump → 旧 receipt 自动降级为 revision_mismatch（unknown），不永久有效。 |
| **死亡告警（停了谁知道）** | | nightly 负向矩阵红 → `integration-nightly.yml` 自动开 `[integration-red]` P1 Issue（按日期去重）；PR-CI smoke 红 → PR 阻塞不可合并。 |
| **失败语义（挂了怎么办）** | | fail-closed：任何身份/SHA/Feature/receipt 不齐 → not green（拦截，不放行）；证据不足（evidence_insufficient）与实现缺陷区分（见 INV-2）。 |
| **效果确认（已发≠已生效）** | | 落账后必须经 `GET /capabilities/F1/certification` 回读 state=green + receipt_id 非 null + psql 核实该 receipt 真在库且非 synthetic，方算生效。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳 | 静默丢消息 |
| ⚠️ F1 是否"已认证 green" | A. 只看有无 PASS receipt; B. 当前 revision 的非 synthetic PASS receipt 且冻结身份齐 | B | 只看 A 会被历史/错 SHA/synthetic receipt 冒充，直接面客错误 | 静默把未认证 Capability 报成 green（面客误导，不可逆信任） |
| ⚠️ receipt 是否对应"本轮 merge SHA" | A. 任意 source_sha; B. source_sha == 冻结 merge SHA（expected_merge_sha） | B | 共享 validation clock 会让错 PR 的 receipt 混入 | 错 SHA receipt 顶替，认证挂错提交 |
| 缺 receipt 是"证据不足"还是"缺陷" | A. 一律判 red; B. 无 receipt→gray(no_receipt) 优先补证据，receipt FAIL→red(缺陷) | B | INV-2 铁律：evidence_insufficient 优先补证据而非直接判缺陷 | 把补证据问题误报成实现缺陷，浪费返修轮次 |

> ⚠️ 两个判定点误判后果严重（面客/不可逆信任）。PrepPRD/对齐会未逐点拍板 → notes 标注待确认：
> `judgment-pending-user: F1 green 判据（当前 revision 非 synthetic PASS + 冻结身份齐）`
> `judgment-pending-user: receipt↔merge SHA 绑定（source_sha == 冻结 merge SHA）`

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 缺必填 query 参数 | HTTP 400 `{error}`，不查库 | 是 | 调用方补参重试 |
| 冻结 hash 与 signed 合同不符 | 200 state=gray reason=contract_identity_mismatch（fail-closed） | 是（纯读） | 不 green，Mapper 结论透出原因 |
| 无 receipt | 200 state=gray reason=no_receipt | 是 | 优先走 Evaluator 补证据（INV-2） |
| receipt source_sha≠冻结 merge SHA | 200 state=unknown reason=revision_mismatch | 是 | 不 green，拒绝共享 clock |
| receipt verdict=FAIL | 200 state=red reason=receipt_fail | 是 | 判缺陷，进返修 |
| DB 不可达 | HTTP 503 `{error}` | 是（纯读） | 调用方重试，不得静默当 green |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A — 本 sprint 无对外暴露 agent（纯内部 Brain 认证读路径 + 内部 loopback 写路径），故 N/A | 内部 | N/A | query 参数仅作身份匹配，不进 LLM prompt |

## Golden Path

[冻结 GP Contract 身份] → [Evaluator receipt 精确落账] → [Mapper fail-closed 聚合] → [非 synthetic PASS receipt + Mapper 结论 green 回读]

---

### Step 1: 以 task_bundle 冻结身份开工（禁按 Journey 猜最新 GP）
**来源**: `[FROM_PRD]` — PRD Golden Path 具体第 1 条（"以 Task payload 冻结的 journey_id/anchor.gp_id/anchor.step_id/gp_contract_id+version+hash 为唯一身份"）。

**可观测行为**: 认证入口读取的冻结身份与 `golden_path_contract_versions` 中 `id=48ef45ab / version=1 / content_hash=3ade5843… / status=signed` 一行相符；hash 不符则 fail-closed 不 green。

**验证命令**:
```bash
curl -sf "localhost:5221/api/brain/golden-paths/8943227f-20dd-4c54-ad06-d12e6ed2e705/contracts" \
  | jq -e '.contract_versions[] | select(.id=="48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3") | (.version==1 and .content_hash=="3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8" and .status=="signed")'
```
**硬阈值**: 冻结合同存在且 signed，hash 逐字符相符。对应可执行命令即上。

---

### Step 2: Evaluator receipt 精确落账（复用 persistTrustedEvaluatorReceipts）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（"Evaluator 把 assertion receipt 精确落 `journey_assertion_receipts`"）。

**可观测行为**: F1 的 journey_step_link 上出现**恰一条**非 synthetic PASS receipt，绑定 `(run_id, journey_step_link_id, source_sha=merge SHA, impact_contract_hash)`；`verdict=PASS / exit_code=0 / synthetic=false / source_sha 40hex / machine_id 非空 / scenario_count>0`。

**验证命令**:
```bash
psql "$DB_URL" -tAc "SELECT count(*) FROM journey_assertion_receipts WHERE journey_step_link_id='$JSL_ID' AND verdict='PASS' AND synthetic=false AND source_sha='$MERGE_SHA' AND created_at > NOW() - interval '10 minutes'"
# 期望：1
```
**硬阈值**: count = 1（恰一条，带时间窗防历史冒充）。

---

### Step 3: Mapper fail-closed 聚合（复用 resolveNodeState / aggregateCapabilityState）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 边界情况（"Mapper fail-closed 聚合"）。

**可观测行为**: 认证端点对同一冻结身份返回 `state=green` + `reason_code=pass_current_revision` + `receipt_id` 非 null + `synthetic=false` + `merge_sha` 与 receipt 一致；四种反向输入（无合同/无 receipt/错 SHA/缺 Feature）返回的 `state` 均 ≠ green。

**验证命令**:
```bash
curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$MERGE_SHA" \
  | jq -e '.capability=="F1" and .state=="green" and .synthetic==false and (.receipt_id|type=="string") and .gp_contract_hash=="3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8"'
```
**硬阈值**: state=green 且 synthetic=false 且 receipt_id 非空 且回显冻结 hash。

---

### Step 4: 非 synthetic PASS receipt + Mapper 结论回读（可观测出口）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：把 PRD "可观测出口"锚成**单条可复跑断言**（同一 receipt 既被 psql 证实真在库非 synthetic，又被端点回读 green），防止"端点撒谎"与"历史 receipt 冒充"两类假绿。

**可观测行为**: 端点回读的 `receipt_id` 与 psql 查到的那条非 synthetic PASS receipt 是**同一行**。

**验证命令**:
```bash
RID=$(curl -sf "localhost:5221/api/brain/capabilities/F1/certification?gp_contract_id=48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3&gp_contract_version=1&gp_contract_hash=3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8&journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&step_id=aad25bdb-bdd6-47f4-9a99-e1176e23ac8b&expected_merge_sha=$MERGE_SHA" | jq -r '.receipt_id')
psql "$DB_URL" -tAc "SELECT count(*) FROM journey_assertion_receipts WHERE id='$RID' AND verdict='PASS' AND synthetic=false" | grep -qx 1
```
**硬阈值**: 端点 receipt_id 对应的库行存在、PASS、非 synthetic。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 单块脚本。evaluator 在 fleet-worker 注入 attempt 级 `$DB_URL`（全新空库）；脚本先跑仓库真实 migration bootstrap，再用 Generator 交付的**幂等 seed helper** 播撒冻结身份 + F1 journey 骨架 + receipt（seed 的深层落账正确性由 nightly 集成测试守护），再启动真实 Brain（5221）curl 认证端点做正向 + 四反向断言。所有 receipt 走真 PG（禁 mock 被改的边）。冻结身份为运行前稳定对象可字面固定；receipt 的 machine_id/harness_attempt_id 由 seed helper 生成（`gen_random_uuid()`），不写死角色 attempt UUID。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
GP_ID="48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3"
GP_HASH="3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8"
JOURNEY_ID="e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29"
STEP_ID="aad25bdb-bdd6-47f4-9a99-e1176e23ac8b"
BASE="localhost:5221/api/brain/capabilities/F1/certification"
BRAIN_PID=""
cleanup() { [ -z "$BRAIN_PID" ] || kill "$BRAIN_PID" 2>/dev/null || true; }
trap cleanup EXIT

# 1. 空库 bootstrap：跑仓库真实 migration，机检目标表存在
( cd packages/brain && node src/migrate.js )
psql "$DB_URL" -tAc "SELECT to_regclass('public.journey_assertion_receipts') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('public.golden_path_contract_versions') IS NOT NULL" | grep -qx t

# 2. 启动真实 Brain server，等健康
( cd packages/brain && BRAIN_PORT=5221 CECELIA_TICK_ENABLED=false node server.js ) >/tmp/f1-brain.log 2>&1 &
BRAIN_PID=$!
for i in $(seq 1 60); do
  curl -sf "localhost:5221/api/brain/tick/status" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "FAIL: Brain 未就绪"; exit 1; }
  sleep 1
done

# 3. 正向：seed green 案，回读端点断言 green + 非 synthetic + 回显冻结 hash
GREEN_JSON=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js green)
JSL_ID=$(echo "$GREEN_JSON" | jq -r '.journey_step_link_id')
MERGE_SHA=$(echo "$GREEN_JSON" | jq -r '.source_sha')
Q="gp_contract_id=$GP_ID&gp_contract_version=1&gp_contract_hash=$GP_HASH&journey_id=$JOURNEY_ID&step_id=$STEP_ID&expected_merge_sha=$MERGE_SHA"
RESP=$(curl -sf "$BASE?$Q")
echo "$RESP" | jq -e '.capability=="F1" and .state=="green" and .synthetic==false and (.receipt_id|type=="string") and .gp_contract_hash=="'"$GP_HASH"'"' \
  || { echo "FAIL: 正向未 green: $RESP"; exit 1; }
RID=$(echo "$RESP" | jq -r '.receipt_id')
psql "$DB_URL" -tAc "SELECT count(*) FROM journey_assertion_receipts WHERE id='$RID' AND verdict='PASS' AND synthetic=false AND source_sha='$MERGE_SHA'" | grep -qx 1 \
  || { echo "FAIL: 端点 receipt_id 与库行不一致"; exit 1; }

# 4. 反向矩阵：无 receipt / 错 SHA / 缺 Feature / 无合同 四案，state 必 ≠ green
for CASE in no_receipt wrong_sha missing_feature no_contract; do
  CJ=$(node packages/brain/scripts/integration/seed-f1-cert-fixture.js "$CASE")
  CMERGE=$(echo "$CJ" | jq -r '.source_sha')
  CHASH=$(echo "$CJ" | jq -r '.gp_contract_hash')
  CQ="gp_contract_id=$GP_ID&gp_contract_version=1&gp_contract_hash=$CHASH&journey_id=$JOURNEY_ID&step_id=$STEP_ID&expected_merge_sha=$CMERGE"
  CR=$(curl -sf "$BASE?$CQ")
  echo "$CR" | jq -e '.state != "green"' >/dev/null \
    || { echo "FAIL: 反向 $CASE 竟 green（未 fail-closed）: $CR"; exit 1; }
  echo "OK reverse[$CASE] state=$(echo "$CR" | jq -r '.state') reason=$(echo "$CR" | jq -r '.reason_code')"
done

echo "✅ F1 认证闭环 Golden Path 验证通过（正向 green + 四反向 fail-closed）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `GET /capabilities/F1/certification` 缺任一必填 query（如去掉 gp_contract_hash）→ 预期 HTTP 400 `{error}`，不得 500/不得当 green
- 错输入: gp_contract_hash 传一个合法 64hex 但非 signed 合同 → 预期 state=gray reason=contract_identity_mismatch，不得 green
- 重复提交: 同一 (run_id, journey_step_link_id, source_sha, impact_contract_hash) 二次落账 → append-only + ON CONFLICT DO NOTHING，不得产生第二行、不得 500
- 中途中断: seed green 后手动把该 receipt 的 assertion_revision 对应 journey_step_link 的 assertion_ref 改动（触发 revision bump）→ 端点应从 green 退化为 unknown(revision_mismatch)
- 边界值: source_sha 传 39/41 位 hex → 落账应被 DB CHECK 拒（PASS 需严格 40hex），端点不得 green
发现分级: P0/P1（把未认证 Capability 报 green / append-only 被绕过 / 错 SHA 混入）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| F1 认证正向 smoke（PR CI）| `sprints/0813-f1-capability-certification-r3/tests/f1-certification-smoke.test.ts` | `certification 端点对冻结身份返回 green`、`无 receipt 时不 green` | 端点 404 / seed helper 缺失 → fail |
| F1 认证负向矩阵（nightly）| `packages/brain/src/__tests__/integration/f1-capability-certification.integration.test.js`（Generator 交付并登记进 `vitest.config.js` `POSTGRES_INTEGRATION_TESTS`）| `无合同时不 green`、`无 receipt 时不 green`、`错 SHA 时不 green`、`缺 Feature 时不 green`、`非 synthetic PASS receipt 精确落账` | 端点/模块缺失 → fail |

> 「BEHAVIOR 覆盖」名均为对应 `it()` 名的字面子串（先写 it() 名再截子串）。
