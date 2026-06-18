# Sprint Contract Draft (Round 2) — Cockpit Phase 3 · Gate 1 决策面板 + 点火

**journey_type**: user_facing
**target_environment**: mac_web（Cecelia 内网 Dashboard，Playwright 本机 localhost:5174 + Brain localhost:5221 写副作用校验）

> **Round 2 修订摘要**（处理 Round1 REVISION：dim2=5 / dim6=6）：
> 1. **dim2 决策口径**：补 `[ASSUMPTION-决策口径]`——本 pipeline 待决策项口径锁定 + list/edit 同源（都落 `decisions` 表）规则；Step 1 oracle/E2E 注入决策挂到 PIPELINE_ID 并验证可被列出（修「全局 GET 无 pipeline 过滤」与 PRD「该 pipeline 待决策项」矛盾）。
> 2. **dim6 oracle 完整性**：Step 4 fire 补点火留痕 oracle（`SELECT count(*) FROM initiative_run_events WHERE initiative_id AND node='fire'` 带时间窗），指定 fire 事件合法 status=`done`；fire/decision 补禁用字段反向 `! jq -e`。
> 3. **dim2 边界覆盖**：补 PRD 边界 step/oracle——「查无待决策项→暂无占位」「改决策/点火失败→内联报错保留输入不崩」（gate1-*-error toBeVisible + 输入保留 + 不崩页 + 空态占位断言）。

---

## 已知约束（来自回归测试）

- [apps/dashboard/.../__tests__/PipelineLifecycle.test.tsx] → 七项生命周期分区 testid `lifecycle-section-<key>`，docs tab 激活后逐项 fetch；占位三态字面不可改：`未到该步` / `取数失败` / `暂无决策`
- [apps/dashboard/.../__tests__/PipelineLifecycle.test.tsx] → 取数失败必须显示 `取数失败`（≠ `未到该步`），整页不崩；decisions 空显示 `暂无决策`
- [packages/brain lifecycle-contract.test.ts] → 七项分区顺序为合同 SSOT，Phase 3 不得改动既有七项顺序/key（只在 decisions 分区内扩出 Gate 1 操作面）
- [HarnessPipelineDetailPage.tsx:840-848] → Phase 2 现状：decisions 分区 list 走 `GET /api/brain/decisions`（实为 `status.js`→`decision_log` 表，**无 target 列**），却按 `d.target.includes(pipelineId)` 客户端过滤 → 现状恒空。本 Sprint 必须修同源（见 [ASSUMPTION-决策口径]）。

---

## [ASSUMPTION-决策口径]（dim2 修订核心 — 落地 PRD「该 pipeline 的待决策项」）

> Round1 REVISION 指出：面板若用全局 `GET /api/brain/decisions` 无 pipeline 过滤，与 PRD「该 pipeline 待决策项」矛盾。本节锁定口径，Reviewer 据此审 scope_match_prd。

源码核验事实：
- `GET /api/brain/decisions`（`status.js:270`）查 **`decision_log` 表**，无 target 列、无 pipeline 过滤，仅 `?limit`。
- 编辑决策走 `PUT /api/brain/strategic-decisions/:id`（`strategic-decisions.js:110`），写的是 **`decisions` 表**（列含 `category/topic/decision/reason/status/target_type/target_id/updated_at`，migration 009 + 302）。
- `decisions` 表已有按目标过滤的端点：`GET /api/brain/abilities/:id/decisions`（`target_type='journey_feature'`）、`GET /api/brain/golden_path/:id/decisions`（`target_type='golden_path'`）、`GET /api/brain/strategic-decisions?status=active`（`decisions` 表 active 行）。

**锁定口径**：
1. **本 pipeline 待决策项 = `decisions` 表中 `status='active'` 且关联本 pipeline 的行**。关联键：`decisions.target_id` 指向本 pipeline 对应的 task/ability/golden_path（沿用 Phase 2 详情页 `pipelineId` 关联过滤）；当本 pipeline 无 target 映射时，退化为全局 active 决策口径（占位仍走「暂无决策」三态）。
2. **list 与 edit 必须同源（都落 `decisions` 表）**。Phase 2 现状 list 走 `decision_log`、edit 走 `decisions`，二者异源 → 改了不刷新。本 Sprint 必须把 Gate 1 面板 list 源改为 `decisions` 表（`GET /api/brain/strategic-decisions?status=active`，或按 target 过滤的 scoped 端点），与 `PUT /api/brain/strategic-decisions/:id` 同源。
3. **oracle/E2E 注入决策时落 `decisions` 表 active 行**，并把 `target_id` 挂到 PIPELINE_ID 关联，保证「该 pipeline 待决策项」在面板真实可见、可被定点改回读。

---

## Response Schema（推导来源: 源码核验 + PRD 锁定）

> Brain 离线、api_registry 取不到，按 `strategic-decisions.js`、`harness.js`、migration 238/279/302 源码现状推导；新端点按 harness 写端点既有 `{ok:true,...}` 成功 / `{error:"..."}` 失败风格锁定。

### Endpoint A（既有，复用，已挂载 `server.js:293`）: PUT /api/brain/strategic-decisions/:id — 改单条决策
**Success (HTTP 200)**:
```json
{"success": true, "data": {"id": "<uuid>", "category": "<str>", "topic": "<str>", "decision": "<new value>", "reason": "<str>", "status": "active", "updated_at": "<iso>"}}
```
- `success` (boolean, 必填): 来源——strategic-decisions.js 既有 `{success:true,data}` 风格
- `data.id` (string, 必填): 被改决策 id（`decisions` 表行 id）
- `data.decision` (string, 必填): 改动后的取值（字面回显，用于校验写入成功）
- `data.updated_at` (string, 必填): 更新时间戳

**禁用字段名**: `value`、`content`（`decisions` 表列名是 `decision`，不得漂移）
**Request Body**: `{"decision": "<new value>"}`（PUT 支持部分更新；可选附 `reason`/`status`）
**Error (HTTP 404)**: `{"success": false, "error": "Decision not found"}`
**Error (HTTP 400, 无可更新字段)**: `{"success": false, "error": "没有可更新的字段"}`

### Endpoint B（新增，本 Sprint 锁定）: POST /api/brain/harness/initiative/:initiative_id/fire — 确定点火
**Success (HTTP 200)**:
```json
{"ok": true, "initiative_id": "<uuid>", "from_phase": "A_contract", "to_phase": "B_task_loop", "fired_at": "<iso>"}
```
- `ok` (boolean, 必填): 来源——harness.js 既有 `{ok:true}` 风格
- `initiative_id` (string, 必填): 被点火的 initiative
- `from_phase` (string, 必填): 点火前 phase，固定 `"A_contract"`
- `to_phase` (string, 必填): 点火后 phase，固定 `"B_task_loop"`（Gate 1 → 执行）
- `fired_at` (string, 必填): 点火时间戳

**禁用字段名**: `phase`（必须用 `from_phase`/`to_phase` 二元，禁单 `phase` 含糊）、`status`（fire 走 `ok` 风格不混 `status`）、`success`（fire 不走 strategic-decisions 的 `success` 风格）
**副作用 1**: `UPDATE initiative_runs SET phase='B_task_loop' WHERE initiative_id=$1 AND phase='A_contract'`
**副作用 2（点火留痕，PRD step6 要求）**: 写一条 `initiative_run_events(initiative_id, node='fire', status='done', ts=EXTRACT(EPOCH FROM NOW()))` 留痕行。`status='done'` 为 `initiative_run_events.status` CHECK 合法值（migration 279 允许 `running/done/failed`；migration 293 另加 `completed`——取交集 `done` 最稳）。
**Error (HTTP 409, 非 Gate 1)**: `{"error": "pipeline not in Gate 1 (phase=<current>)"}`（不静默吞错）
**Error (HTTP 404, initiative 不存在)**: `{"error": "initiative run not found"}`

### Endpoint C（新增，本 Sprint 锁定）: POST /api/brain/harness/initiative/:initiative_id/rechallenge — 再来一轮无头红队
**Success (HTTP 200)**:
```json
{"ok": true, "initiative_id": "<uuid>", "rechallenge_triggered": true, "round": 2}
```
- `ok` (boolean, 必填): 同 harness 写端点风格
- `rechallenge_triggered` (boolean, 必填): 是否成功触发无头红队再质询（既有 GAN 入口）
- `round` (number, 必填): 触发后目标轮次（current_round + 1）

**禁用字段名**: `started`、`queued`、`status`（用 `rechallenge_triggered` 字面）
**副作用**: 触发既有无头红队 GAN 再质询入口（不实现红队算法本身，仅触发既有入口 + 入队/事件留痕）
**Error (HTTP 409, 非 Gate 1)**: `{"error": "pipeline not in Gate 1 (phase=<current>)"}`

> **Gate 1 判定（[ASSUMPTION] 落地）**：`initiative_runs.phase === 'A_contract'` ⇒ 停在 Gate 1。前端用既有 `GET /api/brain/harness/runs/:id/progress` 返回的 `phase` 字段判定（源码 `harness.js:137-193` 确认返回 `phase`），不新增状态机（migration 238 枚举 `A_contract|B_task_loop|C_final_e2e|done|failed`）。

---

## Golden Path

[打开停在 Gate 1 的 pipeline 详情页] → [展开 Gate 1 决策面板列出该 pipeline 待决策项] → [改一条决策保存写回 Brain] → [（可选）再来一轮红队再质询] → [确定点火] → [pipeline 离开 Gate 1 进入执行 B_task_loop 并留痕]

### Step 1: 打开停在 Gate 1 的详情页，决策面板列出**该 pipeline**待决策项
**来源**: `[FROM_PRD]` — Golden Path 第 1-2 步「打开停在 Gate 1 状态的 pipeline 详情页」「展开 Gate 1 决策面板：列出本轮待决策项（来自该 pipeline 的 decisions）」

**可观测行为**: docs tab 下 `decisions` 分区内出现 Gate 1 决策面板（`gate1-decision-panel`），列出**关联本 pipeline 的 active 决策项**（list 源 = `decisions` 表，与 edit 同源，见 [ASSUMPTION-决策口径]），每项可读内容与当前取值。判定条件 `progress.phase === 'A_contract'`。

**验证命令**（Mode A，manual:bash，注入 active 决策挂 target→PIPELINE_ID 并断言可被列出）:
```bash
IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'A_contract') RETURNING initiative_id" | tr -d ' ')
DID=$(psql $DB -t -c "INSERT INTO decisions (category,topic,decision,status,target_type,target_id) VALUES ('gate1','合同断言取值','old-val','active','journey_feature','$IID') RETURNING id" | tr -d ' ')
# list 源同源 decisions 表（active 行），断言注入项可被列出
curl -sf "localhost:5221/api/brain/strategic-decisions?status=active" | jq -e --arg id "$DID" '.data | map(.id) | index($id) != null' || { echo "FAIL: 注入 active 决策未出现在 list 源"; exit 1; }
echo OK
```
**硬阈值**: phase=A_contract 时面板可见且至少列出关联本 pipeline 的 active 决策项（list 源 = `decisions` 表，与 edit 同源）

---

### Step 2: 编辑一条决策并保存，写回 Brain（与 list 同源）
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「可编辑某一条决策的取值并保存（写回 Brain）」

**可观测行为**: 用户改 `gate1-decision-edit-input` 取值，点 `gate1-decision-save-btn` → 命中 `PUT /api/brain/strategic-decisions/:id` → `decisions` 表该行 `decision` 字段更新；保存成功 UI 反映新值（list 同源 → 改了即刷新）。

**验证命令**（Mode A，manual:bash，response + DB 定点读双校验 + 禁用字段反向）:
```bash
DID=$(psql $DB -t -c "INSERT INTO decisions (category,topic,decision,status) VALUES ('gate1','t','old-val','active') RETURNING id" | tr -d ' ')
RESP=$(curl -sf -X PUT "localhost:5221/api/brain/strategic-decisions/$DID" -H 'Content-Type: application/json' -d '{"decision":"new-val-e2e"}')
echo "$RESP" | jq -e '.success == true and .data.decision == "new-val-e2e"' || { echo FAIL; exit 1; }
# 禁用字段反向：不得漂移到 value/content
echo "$RESP" | jq -e '.data | has("value") | not' || { echo "FAIL: 禁用字段 value 漏网"; exit 1; }
echo "$RESP" | jq -e '.data | has("content") | not' || { echo "FAIL: 禁用字段 content 漏网"; exit 1; }
NEW=$(psql $DB -t -c "SELECT decision FROM decisions WHERE id='$DID'" | tr -d ' ')
[ "$NEW" = "new-val-e2e" ] || { echo "FAIL: DB 未更新 decision=$NEW"; exit 1; }
echo OK
```
**硬阈值**: response `data.decision == "new-val-e2e"` 且 DB 定点读 `decision` 字段 == 新值；response 不含 `value`/`content`

---

### Step 3: （可选）点「再来一轮」触发无头红队再质询
**来源**: `[FROM_PRD]` — Golden Path 第 4 步「可点『再来一轮』：触发无头红队对当前合同/决策再质询一轮（不需人工干预），结果回灌」

**可观测行为**: 点 `gate1-rechallenge-btn` → 命中 `POST /api/brain/harness/initiative/:id/rechallenge` → 返回 `rechallenge_triggered:true`；按钮触发后置忙（`disabled`/`aria-busy`），禁止重复触发。

**验证命令**（Mode A，manual:bash，新端点必须 200，404=未注册=FAIL）:
```bash
IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'A_contract') RETURNING initiative_id" | tr -d ' ')
curl -sf -X POST "localhost:5221/api/brain/harness/initiative/$IID/rechallenge" -H 'Content-Type: application/json' -d '{}' | jq -e '.ok == true and .rechallenge_triggered == true' || { echo FAIL; exit 1; }
echo OK
```
**硬阈值**: HTTP 200 + `ok==true` + `rechallenge_triggered==true`（端点未实现则 curl -f 失败 → FAIL）

---

### Step 4: 确定点火，pipeline 离开 Gate 1 进入执行**并留痕**
**来源**: `[FROM_PRD]` — Golden Path 第 5-6 步「点『确定点火』→ pipeline 状态从 Gate 1 推进到执行」「Brain 侧记录到这次点火」

**可观测行为**: 点 `gate1-fire-btn` → 命中 `POST /api/brain/harness/initiative/:id/fire` → 返回 `to_phase:"B_task_loop"`；`initiative_runs.phase` 由 `A_contract` 真改为 `B_task_loop`；**并在 `initiative_run_events` 写一条 `node='fire'` 留痕行（PRD step6「记录到这次点火」）**。

**验证命令**（Mode A，manual:bash，新端点 + DB 定点读副作用 + 留痕 oracle + 禁用字段反向）:
```bash
IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'A_contract') RETURNING initiative_id" | tr -d ' ')
RESP=$(curl -sf -X POST "localhost:5221/api/brain/harness/initiative/$IID/fire" -H 'Content-Type: application/json' -d '{}')
echo "$RESP" | jq -e '.ok == true and .from_phase == "A_contract" and .to_phase == "B_task_loop"' || { echo FAIL; exit 1; }
# 禁用字段反向：fire 必须用 from_phase/to_phase 二元，不得返回单 phase / status
echo "$RESP" | jq -e 'has("phase") | not' || { echo "FAIL: 禁用字段 phase 漏网（应用 from_phase/to_phase）"; exit 1; }
echo "$RESP" | jq -e 'has("status") | not' || { echo "FAIL: 禁用字段 status 漏网"; exit 1; }
# 副作用 1：phase 真被推进
PH=$(psql $DB -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='$IID'" | tr -d ' ')
[ "$PH" = "B_task_loop" ] || { echo "FAIL: phase 未推进 phase=$PH"; exit 1; }
# 副作用 2：点火留痕（PRD step6），带时间窗防历史冒充（ts 为 BIGINT unix 秒）
CNT=$(psql $DB -t -c "SELECT count(*) FROM initiative_run_events WHERE initiative_id='$IID' AND node='fire' AND status='done' AND ts > EXTRACT(EPOCH FROM NOW())::BIGINT - 300" | tr -d ' ')
[ "$CNT" -ge 1 ] || { echo "FAIL: 点火留痕缺失 node=fire count=$CNT"; exit 1; }
echo OK
```
**硬阈值**: response `to_phase=="B_task_loop"` 且不含 `phase`/`status`；DB `phase=="B_task_loop"`；`initiative_run_events` 5 分钟内有 ≥1 条 `node='fire' status='done'` 留痕行

---

### Step 5: 点火后页面反映 pipeline 已离开 Gate 1
**来源**: `[FROM_PRD]` — Golden Path 第 6 步「点火后页面反映 pipeline 已离开 Gate 1（状态/留痕更新）」

**可观测行为**: 点火返回后页面刷新 `progress`，phase 变为 `B_task_loop`；Gate 1 决策面板按降级规则禁用「确定点火」（已离开 Gate 1）。

**验证命令**（UI，Playwright + 后端交叉校验，见 ## E2E 验收）:
```javascript
const r = await page.request.get(`http://localhost:5221/api/brain/harness/runs/${PIPELINE_ID}/progress`);
const d = await r.json();
if (d.phase !== 'B_task_loop') { console.error('FAIL: 后端 phase 未离开 Gate 1', d); process.exit(1); }
```
**硬阈值**: 点火后后端 `phase == "B_task_loop"`，页面火按钮按离开 Gate 1 降级

---

### Step 6: 非 Gate 1 状态降级（边界 — PRD 边界第 1 条）
**来源**: `[FROM_PRD]` — 边界第 1 条「pipeline 不在 Gate 1 → 决策面板按状态降级：展示但禁用『确定点火』，给语义化提示，不报错」

**可观测行为**: phase ≠ `A_contract`（如 `done`）时，`gate1-fire-btn` 置 `disabled`，出现语义化提示 `gate1-fire-disabled-hint`，面板不报错、不崩页。

**验证命令**（UI，Playwright，见 ## E2E 验收 降级用例）:
```javascript
await expect(page.locator('[data-testid="gate1-fire-btn"]')).toBeDisabled();
await expect(page.locator('[data-testid="gate1-fire-disabled-hint"]')).toBeVisible();
await expect(page.locator('[data-testid="docs-tab-content"]')).toBeVisible(); // 不崩页
```
**硬阈值**: 非 Gate 1 时 fire 按钮 disabled + 语义化提示可见 + 整页不崩

---

### Step 7: 查无待决策项 → 暂无占位（边界 — PRD 边界第 2 条）
**来源**: `[FROM_PRD]` — 边界第 2 条「决策面板查无待决策项 → 显示『暂无待决策』占位，『确定点火』按是否允许直接放行决定可用性」

**可观测行为**: Gate 1（phase=A_contract）但本 pipeline 无 active 待决策项时，面板列表区显示空态占位 `gate1-empty`（语义化「暂无待决策」），不报错、不崩页；`gate1-fire-btn` 仍按 Gate 1 可用（PRD「按是否允许直接放行」，无待决策不阻塞点火）。

**验证命令**（UI，Playwright，见 ## E2E 验收 空态用例）:
```javascript
await expect(page.locator('[data-testid="gate1-empty"]')).toBeVisible();
await expect(page.locator('[data-testid="docs-tab-content"]')).toBeVisible(); // 不崩页
```
**硬阈值**: Gate 1 且无待决策项时 `gate1-empty` 可见 + 整页不崩

---

### Step 8: 改决策 / 点火失败 → 内联报错保留输入不崩（边界 — PRD 边界第 3 条）
**来源**: `[FROM_PRD]` — 边界第 3 条「改决策保存失败 / 点火端点失败（网络/校验）→ 面板内联报错并保留用户输入，不让整页崩、不静默吞错」

**可观测行为**:
- 改决策保存失败（PUT 返回非 2xx）→ 面板内联出现 `gate1-decision-error`（语义化报错），且 `gate1-decision-edit-input` **保留用户已输入的值**（不清空），整页不崩。
- 点火失败（fire 返回非 2xx）→ 面板内联出现 `gate1-fire-error`，整页不崩，不静默吞错。

**验证命令**（UI，Playwright，见 ## E2E 验收 失败用例）:
```javascript
// 改决策失败：内联报错 + 输入保留 + 不崩
await expect(page.locator('[data-testid="gate1-decision-error"]')).toBeVisible();
await expect(page.locator('[data-testid="gate1-decision-edit-input"]')).toHaveValue('new-val-e2e');
// 点火失败：内联报错 + 不崩
await expect(page.locator('[data-testid="gate1-fire-error"]')).toBeVisible();
await expect(page.locator('[data-testid="docs-tab-content"]')).toBeVisible();
```
**硬阈值**: 写路径失败时对应内联 error 可见 + 用户输入保留 + 整页不崩（不静默吞错）

---

### Step 9: 点火端点服务端越权防护（防造假/防前端绕过）
**来源**: `[AI_ADDED]` — 理由：前端 disable 只是 UI 层，generator 可能仅做前端禁用而后端 fire 端点对任意 phase 都放行，导致「非 Gate 1 也能点火」绕过状态校验。要求服务端对非 `A_contract` 状态返回 409 + error，使「禁用」是真实后端约束而非纯前端装饰。

**可观测行为**: 对 phase=`done` 的 initiative 调 fire → 返回 4xx + `error` 字段，phase 不被改动，且**不写 fire 留痕**（越权不留痕）。

**验证命令**（Mode A，manual:bash，negative，捕获状态码）:
```bash
IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'done') RETURNING initiative_id" | tr -d ' ')
CODE=$(curl -s -o /tmp/fire_resp.json -w '%{http_code}' -X POST "localhost:5221/api/brain/harness/initiative/$IID/fire" -H 'Content-Type: application/json' -d '{}')
{ [ "$CODE" = "409" ] || [ "$CODE" = "400" ]; } || { echo "FAIL: 非 Gate1 点火未被拒 code=$CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/fire_resp.json || { echo "FAIL: 无 error 字段"; exit 1; }
PH=$(psql $DB -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='$IID'" | tr -d ' ')
[ "$PH" = "done" ] || { echo "FAIL: 越权点火改了 phase=$PH"; exit 1; }
echo OK
```
**硬阈值**: 非 Gate 1 fire 返回 409/400 + `error` 字符串字段，phase 保持不变

---

## 领域验证（UI 交互类 — 强制 oracle）

本 Sprint = UI 交互类（user_facing / mac_web）。合同硬条款：
- E2E 必须含可见状态断言（`toBeVisible` / `toBeDisabled` / `toHaveValue`），禁止只 `page.goto` 不断言（见 ## E2E 验收）。
- 写副作用必须 DB/API 交叉校验（decision 改值 → DB 定点读；fire → 后端 phase + `initiative_run_events` 留痕校验），防前端撒谎。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=mac_web Playwright）

> 由 evaluator 模式 B 在 Mac 本机执行（localhost:5174 真实 Dashboard + localhost:5221 真实 Brain）。GAN 阶段仅产出此脚本模板，proposer 不执行。
> 前置：脚本启动前用 psql 注入一个 phase=`A_contract` 的 initiative_run 及一条挂到该 pipeline 的 `decisions` active 行（`target_id=PIPELINE_ID`），用同一 id 直打详情页与三端点（口径与 Phase 2 一致）。

```javascript
// final-e2e Playwright 脚本（Mac 本机执行）
const { chromium, expect } = require('@playwright/test');
const { execSync } = require('child_process');

(async () => {
  const DB = process.env.DB || 'postgresql://localhost/cecelia';
  const BRAIN = 'http://localhost:5221';
  const psql = (sql) => execSync(`psql "${DB}" -t -c "${sql}"`).toString().trim();

  // 0. 注入 Gate 1 待决策 pipeline（phase=A_contract）+ 一条挂到该 pipeline 的 active 决策
  const PIPELINE_ID = psql(
    "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'A_contract') RETURNING initiative_id"
  );
  const DID = psql(
    `INSERT INTO decisions (category,topic,decision,status,target_type,target_id) VALUES ('gate1','合同断言取值','old-val','active','journey_feature','${PIPELINE_ID}') RETURNING id`
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // 1. 打开停在 Gate 1 的详情页 → docs tab → Gate 1 决策面板列出该 pipeline 待决策项
  await page.goto(`http://localhost:5174/harness-pipeline/${PIPELINE_ID}`);
  await page.waitForLoadState('networkidle');
  await page.click('[data-testid="docs-tab"]');
  await page.screenshot({ path: 'screenshots/01-initial.png' });
  await expect(page.locator('[data-testid="gate1-decision-panel"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="gate1-decision-item"]').first()).toBeVisible();

  // 2. 改一条决策保存 → 交叉校验 Brain DB（list/edit 同源 → 改了即刷新）
  await page.fill('[data-testid="gate1-decision-edit-input"]', 'new-val-e2e');
  await page.click('[data-testid="gate1-decision-save-btn"]');
  await page.screenshot({ path: 'screenshots/02-action.png' });
  await page.waitForTimeout(1500);
  const dbVal = psql(`SELECT decision FROM decisions WHERE id='${DID}'`);
  if (dbVal !== 'new-val-e2e') { console.error('FAIL: decisions 未写回', dbVal); process.exit(1); }

  // 3. （可选）再来一轮红队 — 按钮置忙
  await page.click('[data-testid="gate1-rechallenge-btn"]');
  await expect(page.locator('[data-testid="gate1-rechallenge-btn"]')).toBeDisabled();

  // 4. 确定点火 → pipeline 离开 Gate 1
  await page.click('[data-testid="gate1-fire-btn"]');
  await page.screenshot({ path: 'screenshots/03-result.png' });
  await page.waitForTimeout(1500);

  // 5. 交叉校验后端：phase 已离开 Gate 1 进入 B_task_loop + 点火留痕
  const r = await page.request.get(`${BRAIN}/api/brain/harness/runs/${PIPELINE_ID}/progress`);
  const d = await r.json();
  if (d.phase !== 'B_task_loop') { console.error('FAIL: 后端 phase 未离开 Gate 1', d); process.exit(1); }
  const fireTrace = psql(`SELECT count(*) FROM initiative_run_events WHERE initiative_id='${PIPELINE_ID}' AND node='fire' AND status='done'`);
  if (parseInt(fireTrace, 10) < 1) { console.error('FAIL: 点火留痕缺失', fireTrace); process.exit(1); }

  await context.close();
  await browser.close();
  console.log('✅ Gate 1 决策面板 + 点火 Golden Path UI 验证通过');
})();
```

**边界用例（单独跑，覆盖 PRD 边界 1/2/3）**:
- **降级（非 Gate 1）**: 注入 phase=`done` 的 pipeline，打开详情页 docs tab，断言 `gate1-fire-btn` `toBeDisabled()` 且 `gate1-fire-disabled-hint` `toBeVisible()`，`docs-tab-content` 仍可见（不崩）。
- **空态（Gate 1 无待决策）**: 注入 phase=`A_contract` 但不注入任何关联本 pipeline 的 active 决策，断言 `gate1-empty` `toBeVisible()`，`docs-tab-content` 仍可见（不崩）。
- **写失败（内联报错保留输入不崩）**: 用 `page.route('**/strategic-decisions/**', r => r.fulfill({status:500,body:'{"success":false,"error":"boom"}'}))` 拦截 PUT 模拟失败 → 改决策保存 → 断言 `gate1-decision-error` `toBeVisible()` 且 `gate1-decision-edit-input` `toHaveValue('new-val-e2e')`（输入保留），`docs-tab-content` 仍可见；同理 `page.route('**/fire', ...500)` 模拟点火失败 → 断言 `gate1-fire-error` `toBeVisible()` 且不崩。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Gate 1 决策面板 + 改决策 + 点火 + 降级 + 空态 + 写失败内联报错（前端） | `sprints/tests/gate1-panel.test.tsx` | 面板列出该 pipeline 待决策项 / 改决策调用 PUT / 点火调用 fire / 非 Gate1 降级禁用 / Gate1 空态占位 / 改决策失败内联报错保留输入不崩 | → 6 failures（组件尚无 Gate 1 面板及边界处理） |
