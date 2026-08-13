# Sprint Contract Draft (Round 1) — F1 Capability 认证闭环：冻结 GP Contract identity 贯穿 Evaluator Receipt 与 Mapper

**journey_type**: autonomous
**target_environment**: local_api
**BASE_REPO**: cecelia（`packages/brain/src/lib/contract-gate.js` 存在 → Contract Gate 生效，本合同已按「Contract Gate 惯用法速查表」写断言）

## 锚定父路声明

独立小路（无父路）。PrepPRD 未锚定 golden_path/step（`step_id: none`），journey `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 当前仅 planned ability，无 done 父路可挂。

---

## Golden Path

[Task 冻结 GP identity] → [dispatcher/evaluator task_bundle 显式携带] → [persistTrustedEvaluatorReceipts 精确验证并落 receipt] → [Mapper 五重判据判绿] → [同 SHA 可信认证闭环，多 GP 不串绑]

### Step 1: dispatcher/evaluator 组装 task_bundle 时显式携带冻结 GP identity
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（第 18 行）：三项 identity 显式带入 task_bundle，不由下游重猜。

**可观测行为**: 当源任务 `tasks.payload` 带 `gp_contract_id/gp_contract_version/gp_contract_hash` 时，evaluator 角色的 `task_bundle.inputs` 出现 Proposer 锁定的载体 `gp_contract = { id, version, hash }` 且 `gp_contract_required = true`；缺该三字段的历史任务不注入（`gp_contract_required` 缺省 falsy）。

**验证命令**:
```bash
# buildInputs 对 evaluator 角色透传冻结 GP identity（真跑单测，见 tests/dispatcher-gp-thread.test.js）
cd /workspace/packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-gp-thread.test.js 2>&1 | grep -qE "Test Files[[:space:]]+1 passed"
```
**硬阈值**: 载体键名字面为 `inputs.gp_contract.{id,version,hash}` + `inputs.gp_contract_required`；三字段值逐字等于 `tasks.payload.gp_contract_{id,version,hash}`。

---

### Step 2: persistTrustedEvaluatorReceipts 从 task_bundle 精确验证并落冻结 GP identity
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（第 19 行）+ 边界情况第 1/2 条（第 27-28 行）。

**可观测行为**: writer 从 `inputs.gp_contract` 读冻结 identity；当 `gp_contract_required=true` 时——
- 三字段齐备且格式合法（`id` UUID / `version` 正整数 / `hash` `^[0-9a-f]{64}$`）→ 精确落库 `journey_assertion_receipts.gp_contract_id = id`、`gp_contract_hash = hash`；
- 与 DB 中该 `gp_contract_id` 的 signed 版本 `content_hash` 逐字一致（反串绑）→ 否则 fail-closed；
- 任一字段缺失/格式非法/与 DB signed hash 不一致 → 抛 `assertion_receipt_evidence_invalid`（httpStatus 409），**不落半条**；
- **禁止** 按 Journey 查 `golden_path_contract_versions ORDER BY version DESC` 猜「最新 signed GP」。
`gp_contract_required` 缺省（legacy 任务）→ 保持 `gp_contract_id/hash = NULL` 旧行为，零回归。

**验证命令**:
```bash
# 写路径真 PG：冻结 identity 精确落库 + 反串绑 + fail-closed（真 Postgres，不 mock 写边）
cd /workspace/packages/brain && DATABASE_URL="$DB_URL" npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/f1-gp-identity-closure.integration.test.js -t "精确落库" 2>&1 | grep -qE "Test Files[[:space:]]+1 passed"
```
**硬阈值**: 落库行 `gp_contract_id` = 冻结 id 且 `gp_contract_hash` = 冻结 hash；构造「同 Journey 有更新 signed GP」时落库仍为冻结 id（不串绑）；identity 不全 → 抛错且 `journey_assertion_receipts` 无新增行。

---

### Step 3: Mapper 五重判据判绿（state-resolver）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（第 20 行）+ 边界情况第 3 条（synthetic，第 29 行）。

**可观测行为**: `packages/brain/src/map/state-resolver.js` 判某节点 `green` 必须**同时**满足五条，缺任一 → 非 green：
1. 当前 SHA 匹配（`receipt.source_sha === currentRevision`）；
2. 当前 Impact Contract 匹配（receipt `impact_contract_id/impact_contract_hash` = 当前节点 active Impact Contract）；
3. 精确 GP Contract 匹配（receipt `gp_contract_id` = 该节点冻结的 GP Contract id，非「最新」）；
4. receipt 为真实非 synthetic 的 PASS（`verdict='PASS' AND synthetic=false AND executor_kind='brain_assertion_runner'`）；
5. 该节点全部 step links / Feature 子节点齐备（子节点聚合无缺口，`aggregateCapabilityState` 全 green）。

**验证命令**:
```bash
# Mapper 五重判据 green/非green 分支（真 PG，播种齐/缺子节点、synthetic、错 GP、旧 SHA 各一路）
cd /workspace/packages/brain && DATABASE_URL="$DB_URL" npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/f1-gp-identity-closure.integration.test.js -t "mapper 五重" 2>&1 | grep -qE "Test Files[[:space:]]+1 passed"
```
**硬阈值**: 五条全满足 → `state=green`；任一不满足（synthetic=true / 错 GP id / 旧 source_sha / 缺子节点 / Impact Contract 不符）→ `state != green`。

---

### Step 4: 出口 — 真 PG fixture 五级外键链 + 同 SHA 闭环，多 GP 不串绑
**来源**: `[FROM_PRD]` — PRD 范围限定第 1 条（第 35 行）+ 边界情况第 4 条（migration 409 fixture，第 30 行）。

**可观测行为**: 修复后的真 PostgreSQL fixture 完整播种外键链 `tasks → initiative_runs → harness_impact_contracts → harness_attempts → journey_assertion_receipts`（及 receipts 前置 `golden_path_contract_versions` + `journey_step_links`），不违反任何 CHECK/FK/append-only 约束；同一冻结 GP identity 从 writer 落库到 mapper 判绿全程一致。

**验证命令**:
```bash
# 五级外键链在空库 migrate 后可完整播种，不违反 migration 409/374 约束
cd /workspace/packages/brain && DATABASE_URL="$DB_URL" npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/f1-gp-identity-closure.integration.test.js -t "五级外键链" 2>&1 | grep -qE "Test Files[[:space:]]+1 passed"
```
**硬阈值**: fixture 播种五级链全部成功（无 409 违反）；beforeAll 事务内 `client.query` 断言全过。

---

## Response Schema（推导来源: PRD + migration 374 SSOT；HTTP 层 N/A）

本 sprint 为 Brain 内部认证闭环改造，**不新增 HTTP 端点**（复用现有表/API，PRD 第 11 行）。api_registry 该 journey 无相关端点（Step 1.1 查询为空 → `[NEW_PATTERN]`）。可观测「schema」为 DB 行形态与 mapper 状态对象，来源为 migration 374 SSOT（`packages/brain/migrations/374_gp_assertion_receipts.sql`）与 `state-resolver.js`：

### 落库行: `journey_assertion_receipts`（写入形态）
```json
{"gp_contract_id": "<uuid>", "gp_contract_hash": "<64hex>", "synthetic": false, "executor_kind": "brain_assertion_runner", "verdict": "PASS"}
```
- `gp_contract_id` (uuid, 冻结时必填): 来源——PRD「冻结 gp_contract_id」+ 374 列 `gp_contract_id UUID REFERENCES golden_path_contract_versions(id)`
- `gp_contract_hash` (64hex, 冻结时必填): 来源——374 列 + CHECK `journey_assertion_receipt_contract_chk`（两者同时非空且 hash 匹配 `^[0-9a-f]{64}$`）
- `synthetic` (bool, 恒 false): 374 CHECK `synthetic = false`
- `executor_kind` (string, 恒 `brain_assertion_runner`): 374 CHECK
**禁用字段名/写法**: 不得新增列、不得建平行表；`gp_contract_id` 不得由 `ORDER BY version DESC` 猜得。

### Mapper 状态对象: `resolveNodeState` 返回
```json
{"state": "green|red|gray|unknown|not_applicable", "reason_code": "<string>", "details": {}}
```
- `state` (enum): 来源——`state-resolver.js` 现有枚举（不改枚举，仅收紧 green 判据）
- error 形态: writer fail-closed 抛 `Error{code:'assertion_receipt_evidence_invalid', httpStatus:409}`（复用 `evidenceError`）

---

## 已知约束

### 来自回归测试
- [assertion-receipts.test.js] → 从已认证 evaluator callback 写 append-only receipt；FIXED 归一为 PASS；同命令为所有 source binding 各写一条；缺证据/命令被替换/重复 checks/未绑当前 SHA·机器·合同身份 → 拒绝。**本 sprint 不得回退这些行为，只新增 gp_contract 维度。**
- [migration-374-gp-assertion-receipts.integration.test.js] → receipt 表 CHECK：contract 两字段同空或同非空、verdict/exit_code/source_sha/machine/output_digest/scenario 约束、append-only 触发器（UPDATE/DELETE 阻断）。
- [map-state-resolver.integration.test.js] → 现有 green/red/gray/unknown 判据与 freshness 预算（10min）；本 sprint 只收紧 green，不放宽其他分支。
- [golden-path-contract.integration.test.js] → 冻结 `gp_contract_id/version/hash` 来自 `signAndLaunchGoldenPathContract`，写入 `tasks.payload`（SSOT）。

### 累积 FR
- `[累积FR]` context-manifest 端点 `localhost:5221/api/brain/line/e6f803f2-.../context-manifest`: 本次拉取为空（journey 仅 planned ability）；PRD 第 79 行「本 line 暂无历史」印证。无累积 FR 约束需继承。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统承诺 | 冻结 GP identity 显式贯穿 dispatcher/evaluator→writer→mapper；writer 精确落库、mapper 五重判绿、fixture 播种五级外键链 |
| **NFR（做得多好）** | 性能/可靠性 | fail-closed（默认拒绝）；append-only receipt；查询时现算状态（不吃陈旧 cell_status）；无新表/无平行系统 |
| **Invariant（永不违反）** | 不变量 | ①receipt 表 append-only；②`synthetic=false` 恒成立；③认证只落冻结的那一个 gp_contract_id（不串绑）；④identity 不全绝不落半条 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表 |
| **保质期（何时过期）** | 失效退役 | receipt 绑定 `source_sha` + `gp_contract_hash`；SHA/GP 变更即旧 receipt 自然失活（mapper 判据 1/3 不再匹配 → 非 green），无需人工退役 |
| **死亡告警（停了谁知道）** | 告警 | writer 抛 `assertion_receipt_evidence_invalid`（409）经 harness callback 上抛，evaluator attempt 失败进 harness 台账；mapper 判据缺失 → 节点降 gray/unknown 在 map 面板可见 |
| **失败语义（挂了怎么办）** | 故障策略 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | 落库以 DB 返回行（`RETURNING *`）为回执；mapper green 以查询时现算五重判据为回执，非历史 cell_status |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ receipt 该盖到哪个 GP Contract | A. 按 Journey 最新 signed GP 推断; B. 用 task 冻结的 gp_contract_id 精确匹配 | B（task_bundle 冻结 id + DB signed hash 双重校验） | 多 GP 并存时「最新」会串绑到错误 GP（首轮 #4855 实证根因） | 认证盖到错误 GP，面客可信度错误、不可逆 |
| ⚠️ receipt 是否真实执行产物 | A. 只看 verdict=PASS; B. verdict=PASS AND synthetic=false AND executor_kind=brain_assertion_runner | B | synthetic 行可伪造 PASS | 假绿放行未验证能力 |
| GP identity 是否「一致」 | A. 仅校验 bundle 三字段格式; B. 再与 DB signed 版本 content_hash 逐字比对 | B | 光校验格式挡不住错 id（错 id 也可能格式合法） | 错 id 通过 → 串绑 |

> ⚠️ 行属「升拍板点」级别；PrepPRD 已在 PRD 边界情况明确「精确命中冻结 gp_contract_id，禁止落到最新」，判定点 B 已获对齐，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 冻结 GP identity 缺字段/格式非法 | writer 抛 `assertion_receipt_evidence_invalid`(409)，不落半条 | 是（幂等键 = ON CONFLICT(run_id,journey_step_link_id,source_sha,impact_contract_hash)） | 无降级——fail-closed，等修复重投 |
| 冻结 hash 与 DB signed content_hash 不一致 | 同上抛错拒绝 | 是 | fail-closed |
| mapper 事实源陈旧（>10min） | 节点降 `unknown`（现有行为，不改） | N/A | 现算，陈旧即未知 |
| DB 写冲突（并发同 receipt） | ON CONFLICT DO NOTHING + 回读既有行 | 是 | 幂等回读 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | — | — | — |

本 sprint 无对外暴露 agent（Brain 内部 harness 认证闭环，输入来自受信 dispatcher/evaluator task_bundle）。N/A。

---

## 真实调用方请求 shape（冻结 GP identity 载体 — Proposer 锁定）

冻结 GP identity 的「真实调用方」是 Brain 内部 dispatcher（`buildInputs`）与 evaluator 回调（`harness-callback.js`），非外部设备。载体逐字锁定如下，writer 必须按此 shape 读取，禁止双路径分叉：

- 来源 SSOT：`tasks.payload.gp_contract_id` / `.gp_contract_version` / `.gp_contract_hash`（由 `signAndLaunchGoldenPathContract` 写入，见 `golden-path-contracts.js:424-426`）。
- task_bundle 载体（与 `inputs.impact_gate` **同层**兄弟键，满足 PRD 假设第 47 行「impact_gate 同层」）：
  ```json
  "inputs": {
    "impact_gate": { "contract_id": "...", "contract_hash": "...", "repo": "..." },
    "gp_contract": { "id": "<payload.gp_contract_id>", "version": <payload.gp_contract_version>, "hash": "<payload.gp_contract_hash>" },
    "gp_contract_required": true
  }
  ```
- writer 读取键：`inputs.gp_contract.id` → receipt `gp_contract_id`；`inputs.gp_contract.hash` → receipt `gp_contract_hash`；`inputs.gp_contract_required`（boolean）决定是否强制。
- 认证/字段一致性：writer 落库前以 `SELECT content_hash, status FROM golden_path_contract_versions WHERE id = $gp_contract_id` 交叉核对 `content_hash === inputs.gp_contract.hash`（反串绑），dispatcher 与 evaluator 两路必须传同一 shape。

### Kernel validation identity late-binding
receipt 的 `harness_attempt_id`、`machine_id` 等验收身份在**执行角色**运行时由 Runner 注入（`attempt.id` / `attempt.actual_machine_id` / `HARNESS_*`），**不得**把本 Proposer bundle 的 `attempt_id`(9e578678…)、`capability_snapshot_id`(53b8d265…) 写进合同/测试/落库期望。fixture 中的 attempt UUID 为 `randomUUID()` 生成的合成 fixture 数据，非验收身份。

---

## 未覆盖真实链路清单

- writer 单元测试 `tests/gp-identity-writer.test.js` mock `db.query`（TDD red-green 用，仅测 writer 分支逻辑）｜为什么：单元层快速红绿，不碰 PG｜真验证补位：写路径的真 PG 落库由 `f1-gp-identity-closure.integration.test.js`（brain-integration job 真 Postgres）覆盖，禁 mock 写边（见下）。
- 无第三方 API（LLM/支付/短信等）参与，规则 B N/A。
- 无 `force_*`/dry-run/假数据：本合同 N/A。

---

## 禁 mock 边清单

本单改动涉及「DB 写路径」（`journey_assertion_receipts` INSERT）、「跨模块数据传递」（task_bundle identity 从 dispatcher→evaluator→writer 接力）、「状态机/判绿」（mapper green 判据）——failing test 必须不 mock 被改的那条边：

- 代码 `persistTrustedEvaluatorReceipts` ↔ DB 表 `journey_assertion_receipts`（本单改写入列，integration test 必须真 Postgres 验 `gp_contract_id/hash` 真落行）
- 代码 `persistTrustedEvaluatorReceipts` ↔ DB 表 `golden_path_contract_versions`（本单新增 signed hash 交叉核对，integration test 必须真 PG 验反串绑，不 mock 该 SELECT）
- 代码 `state-resolver.resolveNodeState/getLatestReceipt` ↔ DB 表 `journey_assertion_receipts` + `journey_step_links` + `journey_features`（本单收紧 green 判据，integration test 必须真 PG 播种齐/缺子节点、synthetic、错 GP 各分支）
- fixture ↔ 五级外键链表（`tasks/initiative_runs/harness_impact_contracts/harness_attempts/journey_assertion_receipts`），必须真 PG 播种，不 mock

允许 mock 的更外层：`tests/gp-identity-writer.test.js`（纯 writer 分支单测）与 `tests/dispatcher-gp-thread.test.js`（纯 buildInputs 透传单测）可 mock `db.query` / observed 上下文——这两处测的是「读取与透传逻辑」，不是被改的 DB 写边；DB 写边的红由 integration test 持有。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

（当前仓库 cecelia 根目录无 `product-map/generated/product-map.json`，本段整体跳过，不阻塞。）

contract-gate: 生效（cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在）；断言已按惯用法速查表写（DB 计数带时间窗 / curl 带 -f 或捕获后断言 / 负测捕获后断言）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `inputs.gp_contract` 传 `{id:"not-a-uuid", version:"x", hash:"ZZZ"}`（非 UUID/非整数/非 64hex）→ 必 fail-closed，不得落半条。
- 错输入: `inputs.gp_contract_required=true` 但 `inputs.gp_contract` 整体缺失 → fail-closed。
- 重复提交: 同一 (run_id, journey_step_link_id, source_sha, impact_contract_hash) 二次投递 → ON CONFLICT 幂等，不得写第二行、不得改 gp_contract_id。
- 中途中断/串绑: 播种同 Journey 两个 signed GP（旧=冻结、新=更晚 version），构造 bundle 冻结旧 id → 落库必为旧 id；再把 bundle hash 换成新 GP hash 但 id 仍旧 → DB 交叉核对失败 fail-closed。
- 边界值: receipt `synthetic=true` 或 `executor_kind != brain_assertion_runner` → mapper 判非 green（即便 verdict=PASS）。
- 边界值: 节点缺一个 Feature 子节点（step link 未齐）→ mapper 判非 green。
发现分级: P0/P1（串绑落错 GP / synthetic 判绿 / 落半条）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## E2E 验收（final-e2e 跑 — target_environment = local_api）

> 单 bash 块。Fleet 注入 attempt 级 `DB_URL`（本 sprint 唯一运行时资源）。空库先跑仓库真实 migration（`node src/migrate.js`）再机检目标表，随后真 PG 跑写路径/mapper/fixture 集成测试与 writer 单测。无业务用户/cookie 参与（Brain 内部 harness，非用户面），故不涉及 signup/login 自举。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
export DB="$DB_URL"
REPO_ROOT="${WORKSPACE_PATH:-/workspace}"
cd "$REPO_ROOT"

# 1. 空库跑仓库真实 migration（schema bootstrap），机检目标表存在
( cd packages/brain && node src/migrate.js )
psql "$DB_URL" -tAc "SELECT to_regclass('journey_assertion_receipts') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: journey_assertion_receipts 表缺失（migration 未生效）"; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='journey_assertion_receipts' AND column_name IN ('gp_contract_id','gp_contract_hash','synthetic','executor_kind')" \
  | tr -d ' ' | grep -qx 4 || { echo "FAIL: gp_contract/synthetic/executor_kind 列不全"; exit 1; }

# 2. 写路径 + mapper + 五级外键链 fixture（真 Postgres，禁 mock 写边）
( cd packages/brain && npx vitest run --config vitest.integration.config.js \
    src/__tests__/integration/f1-gp-identity-closure.integration.test.js --reporter=verbose ) 2>&1 \
  | tee /tmp/f1-integration.log
grep -qE "Test Files[[:space:]]+1 passed" /tmp/f1-integration.log \
  || { echo "FAIL: f1 集成测试未全过"; exit 1; }

# 3. writer 冻结 GP identity 单元红转绿（root vitest，无 PG）
npx vitest run sprints/0813-f1-capability-certification-r2/tests/gp-identity-writer.test.js 2>&1 \
  | tee /tmp/f1-writer.log
grep -qE "Tests[[:space:]]+4 passed" /tmp/f1-writer.log \
  || { echo "FAIL: writer 单测未全绿"; exit 1; }

# 4. dispatcher 透传单元（root/brain vitest，无 PG）
( cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-gp-thread.test.js ) 2>&1 \
  | tee /tmp/f1-dispatch.log
grep -qE "Test Files[[:space:]]+1 passed" /tmp/f1-dispatch.log \
  || { echo "FAIL: dispatcher 透传单测未过"; exit 1; }

echo "✅ F1 冻结 GP identity 闭环 E2E 验证通过（同 SHA writer→mapper 一致，多 GP 不串绑）"
```

### CI 分层（PRD NFR 第 65 行）
- **PR required 最短 smoke**：`scripts/smoke/f1-gp-identity-closure-smoke.sh`（跑 writer 单测 + dispatcher 透传单测，无 PG，秒级；由 `ci-smoke-glob-runner` 自动纳管）。
- **完整 fail-closed matrix（真 PG）**：`src/__tests__/integration/f1-gp-identity-closure.integration.test.js` 注册进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`，由 `brain-integration` job（PR）与 `integration-nightly.yml`（nightly）真 Postgres 跑全部 fail-closed 分支。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| writer 读冻结 GP identity 分支逻辑 | `sprints/0813-f1-capability-certification-r2/tests/gp-identity-writer.test.js` | 精确落库到 gp_contract_id/gp_contract_hash；缺失 → fail-closed 抛错；不一致（串绑）→ fail-closed 抛错；legacy 保持 NULL 落库 | 已捕获 3 failed（当前 writer 忽略 gp_contract）见 /tmp/sprint-red.log |
| dispatcher 透传冻结 GP identity | `packages/brain/src/orchestrator/__tests__/dispatcher-gp-thread.test.js`（generator 建） | evaluator 角色 inputs 出现 gp_contract 载体 | → 1 failure（当前 buildInputs 不透传） |
| writer 真 PG 落库 + mapper 五重 + 五级外键链 | `packages/brain/src/__tests__/integration/f1-gp-identity-closure.integration.test.js`（generator 建，注册进 POSTGRES_INTEGRATION_TESTS） | 精确落库；反串绑；mapper 五重；五级外键链 | → 真 PG 下多 it() failure |

> 「BEHAVIOR 覆盖」命名为对应 `it()` 名的字面子串：单测 it 名含「精确落库」「fail-closed」「串绑」「NULL 落库」；integration it 名含「精确落库」「fail-closed」「mapper 五重」「五级外键链」「非空 gp_contract_id」，与本合同 / contract-dod.md 的 `-t` 过滤字面一致（generator 建 it 名时须逐字包含这些子串）。

---

## Invariant 映射（PRD 铁律逐条 → INV 条目，见 contract-dod.md）

- [validation-clock] → N/A：本 sprint 不建/不改 validation clock（不涉及 pr_url/pr_head_sha clock 建立路径），保持默认 fail-closed 不动。
- [local_api-判绿] → 已在本合同「## 八要素需求规范/效果确认」与 NFR 声明「验证真相形态 = 真 PostgreSQL fixture」，对 judge 闸⑤(meta_verification_gap) 预先声明本类为 local_api 真 PG 验证，非无 UI 死锁场景。
- [台账隔离] → N/A：本 sprint 不写 `.harness/progress.md`（controller 台账），不触及 git 追踪。
- [证据窗口] → 锚定 DoD ARTIFACT「TDD RED 证据留存」（`tests/RED-evidence-round1.log` 含 `3 failed` 先红时序）；evaluator 须把 root-cause、Red→Green 时序、exit_code 排进 `.brain-result.json` judge 消费窗口前列（evaluator 侧执法，合同以 RED 证据文件为时序锚）。
