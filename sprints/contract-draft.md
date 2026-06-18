# Sprint Contract Draft (Round 1) — Cockpit Phase 3 · Gate 1 决策面板 + 点火

**journey_type**: user_facing
**target_environment**: mac_web（Cecelia 内网 Dashboard，Playwright 本机 localhost:5174 + Brain localhost:5221 写副作用校验）

---

## 已知约束（来自回归测试）

- [apps/dashboard/.../__tests__/PipelineLifecycle.test.tsx] → 七项生命周期分区 testid `lifecycle-section-<key>`，docs tab 激活后逐项 fetch；占位三态字面不可改：`未到该步` / `取数失败` / `暂无决策`
- [apps/dashboard/.../__tests__/PipelineLifecycle.test.tsx] → 取数失败必须显示 `取数失败`（≠ `未到该步`），整页不崩；decisions 空显示 `暂无决策`
- [packages/brain CI lifecycle-contract.test.ts] → 七项分区顺序为合同 SSOT，Phase 3 不得改动既有七项顺序/key（只在 decisions 分区内扩出 Gate 1 操作面）

---

## Response Schema（推导来源: api_registry 离线 → 读源码 + PRD 锁定）

> Brain 离线、registry 取不到，故按 `packages/brain/src/routes/harness.js`、`strategic-decisions.js`、migration 238 源码现状推导，新端点按 harness 写端点既有风格（`{ok:true,...}` 成功 / `{error:"..."}` 失败）锁定。

### Endpoint A（既有，复用）: PUT /api/brain/strategic-decisions/:id — 改单条决策
**Success (HTTP 200)**:
```json
{"success": true, "data": {"id": "<uuid>", "decision": "<new value>", "status": "active", "updated_at": "<iso>"}}
```
- `success` (boolean, 必填): 来源——strategic-decisions.js 既有风格
- `data.id` (string, 必填): 被改决策 id
- `data.decision` (string, 必填): 改动后的决策取值（字面回显，用于校验写入成功）
- `data.updated_at` (string, 必填): 更新时间戳

**禁用字段名**: `value`、`content`（decisions 表列名是 `decision`，不得漂移）
**Request Body**: `{"decision": "<new value>"}`（可选附 `reason`/`status`）
**Error (HTTP 404)**: `{"success": false, "error": "Decision not found"}`

### Endpoint B（新增，本 Sprint 锁定）: POST /api/brain/harness/initiative/:initiative_id/fire — 确定点火
**Success (HTTP 200)**:
```json
{"ok": true, "initiative_id": "<uuid>", "from_phase": "A_contract", "to_phase": "B_task_loop", "fired_at": "<iso>"}
```
- `ok` (boolean, 必填): 来源——harness.js `/complete`、`/notify` 既有 `{ok:true}` 风格
- `initiative_id` (string, 必填): 被点火的 initiative
- `from_phase` (string, 必填): 点火前 phase，固定 `"A_contract"`
- `to_phase` (string, 必填): 点火后 phase，固定 `"B_task_loop"`（Gate 1 → 执行）
- `fired_at` (string, 必填): 点火时间戳

**禁用字段名**: `status`、`phase`（必须用 `from_phase`/`to_phase` 二元，禁单 `phase` 含糊）、`success`（fire 走 `ok` 风格不走 `success` 风格）
**副作用**: `UPDATE initiative_runs SET phase='B_task_loop', updated_at=NOW() WHERE initiative_id=$1 AND phase='A_contract'`；并写一条留痕事件（复用 initiative_run_events，node='fire'）
**Error (HTTP 409, 非 Gate 1)**: `{"error": "pipeline not in Gate 1 (phase=<current>)"}`（不静默吞错）
**Error (HTTP 404, initiative 不存在)**: `{"error": "initiative_run not found"}`

### Endpoint C（新增，本 Sprint 锁定）: POST /api/brain/harness/initiative/:initiative_id/rechallenge — 再来一轮无头红队
**Success (HTTP 200)**:
```json
{"ok": true, "initiative_id": "<uuid>", "rechallenge_triggered": true, "round": 2}
```
- `ok` (boolean, 必填): 同 harness 写端点风格
- `rechallenge_triggered` (boolean, 必填): 是否成功触发无头红队再质询（既有 GAN 入口）
- `round` (number, 必填): 触发后的目标轮次（current_round + 1）

**禁用字段名**: `started`、`queued`（用 `rechallenge_triggered` 字面）
**副作用**: 触发既有无头红队 GAN 再质询入口（不实现红队算法本身，仅触发既有入口 + 入队/事件留痕）
**Error (HTTP 409, 非 Gate 1)**: `{"error": "pipeline not in Gate 1 (phase=<current>)"}`

> **Gate 1 判定（[ASSUMPTION] 落地）**：`initiative_runs.phase === 'A_contract'` ⇒ 停在 Gate 1（合同/决策待确认）。前端用既有 `GET /api/brain/harness/runs/:id/progress` 返回的 `phase` 字段判定，不新增状态机（migration 238 既有枚举 `A_contract|B_task_loop|C_final_e2e|done|failed`）。

---

## Golden Path

[打开停在 Gate 1 的 pipeline 详情页] → [展开 Gate 1 决策面板列出待决策项] → [改一条决策保存写回 Brain] → [（可选）再来一轮红队再质询] → [确定点火] → [pipeline 离开 Gate 1 进入执行 B_task_loop]

### Step 1: 打开停在 Gate 1 的 pipeline 详情页，决策面板展开
**来源**: `[FROM_PRD]` — Golden Path 第 1-2 步「打开停在 Gate 1 状态的 pipeline 详情页」「展开 Gate 1 决策面板：列出本轮待决策项」

**可观测行为**: docs tab 下 `decisions` 分区内出现 Gate 1 决策面板（`gate1-decision-panel`），列出待决策项（来自 `GET /api/brain/decisions`），每项可读内容与当前取值。判定条件 `progress.phase === 'A_contract'`。

**验证命令**（UI，Playwright，见 ## E2E 验收）:
```javascript
await expect(page.locator('[data-testid="gate1-decision-panel"]')).toBeVisible({ timeout: 10000 });
await expect(page.locator('[data-testid="gate1-decision-item"]').first()).toBeVisible();
```
**硬阈值**: phase=A_contract 时面板可见且至少列出 decisions 中的待决策项

---

### Step 2: 编辑一条决策并保存，写回 Brain
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「可编辑某一条决策的取值并保存（写回 Brain）」

**可观测行为**: 用户改 `gate1-decision-edit-input` 取值，点 `gate1-decision-save-btn` → 命中 `PUT /api/brain/strategic-decisions/:id` → decisions 表该行 `decision` 字段更新；保存成功 UI 反映新值。

**验证命令**（Mode A，manual:bash，真实 Brain + DB 定点读）:
```bash
DID=$(psql $DB -t -c "INSERT INTO decisions (category,topic,decision,status) VALUES ('gate1','t','old-val','active') RETURNING id" | tr -d ' ')
curl -sf -X PUT "localhost:5221/api/brain/strategic-decisions/$DID" -H 'Content-Type: application/json' -d '{"decision":"new-val-e2e"}' | jq -e '.success == true and .data.decision == "new-val-e2e"' || { echo FAIL; exit 1; }
NEW=$(psql $DB -t -c "SELECT decision FROM decisions WHERE id='$DID'" | tr -d ' ')
[ "$NEW" = "new-val-e2e" ] || { echo "FAIL: DB 未更新 decision=$NEW"; exit 1; }
echo OK
```
**硬阈值**: response `data.decision == "new-val-e2e"` 且 DB 定点读 `decision` 字段 == 新值

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

### Step 4: 确定点火，pipeline 离开 Gate 1 进入执行
**来源**: `[FROM_PRD]` — Golden Path 第 5 步「点『确定点火』→ 命中点火端点 → pipeline 状态从 Gate 1 推进到执行」

**可观测行为**: 点 `gate1-fire-btn` → 命中 `POST /api/brain/harness/initiative/:id/fire` → 返回 `to_phase:"B_task_loop"`；`initiative_runs.phase` 由 `A_contract` 真改为 `B_task_loop`。

**验证命令**（Mode A，manual:bash，新端点 + DB 定点读副作用）:
```bash
IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'A_contract') RETURNING initiative_id" | tr -d ' ')
curl -sf -X POST "localhost:5221/api/brain/harness/initiative/$IID/fire" -H 'Content-Type: application/json' -d '{}' | jq -e '.ok == true and .from_phase == "A_contract" and .to_phase == "B_task_loop"' || { echo FAIL; exit 1; }
PH=$(psql $DB -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='$IID'" | tr -d ' ')
[ "$PH" = "B_task_loop" ] || { echo "FAIL: phase 未推进 phase=$PH"; exit 1; }
echo OK
```
**硬阈值**: response `to_phase=="B_task_loop"` 且 DB 定点读 `phase == "B_task_loop"`

---

### Step 5: 点火后页面反映 pipeline 已离开 Gate 1
**来源**: `[FROM_PRD]` — Golden Path 第 6 步「点火后页面反映 pipeline 已离开 Gate 1（状态/留痕更新），Brain 侧记录点火与改动后决策」

**可观测行为**: 点火返回后页面刷新 `progress`，phase 变为 `B_task_loop`；Gate 1 决策面板按降级规则禁用「确定点火」（已离开 Gate 1）。

**验证命令**（UI，Playwright + 后端交叉校验，见 ## E2E 验收）:
```javascript
// 点火后交叉验证 Brain 后端 phase
const r = await page.request.get(`http://localhost:5221/api/brain/harness/runs/${PIPELINE_ID}/progress`);
const d = await r.json();
if (d.phase !== 'B_task_loop') { console.error('FAIL: 后端 phase 未离开 Gate 1', d); process.exit(1); }
```
**硬阈值**: 点火后后端 `phase == "B_task_loop"`，页面火按钮按离开 Gate 1 降级

---

### Step 6: 非 Gate 1 状态降级（边界）
**来源**: `[FROM_PRD]` — 边界情况第 1 条「pipeline 不在 Gate 1（已点火/已完成/尚未到 Gate 1）→ 决策面板按状态降级：展示但禁用『确定点火』，给语义化提示，不报错」

**可观测行为**: phase ≠ `A_contract`（如 `done`）时，`gate1-fire-btn` 置 `disabled`，出现语义化提示 `gate1-fire-disabled-hint`，面板不报错、不崩页。

**验证命令**（UI，Playwright，见 ## E2E 验收 降级用例）:
```javascript
await expect(page.locator('[data-testid="gate1-fire-btn"]')).toBeDisabled();
await expect(page.locator('[data-testid="gate1-fire-disabled-hint"]')).toBeVisible();
```
**硬阈值**: 非 Gate 1 时 fire 按钮 disabled + 语义化提示可见

---

### Step 7: 点火端点服务端越权防护（防造假/防前端绕过）
**来源**: `[AI_ADDED]` — 理由：前端 disable 只是 UI 层，generator 可能仅做前端禁用而后端 fire 端点对任意 phase 都放行，导致「非 Gate 1 也能点火」绕过状态校验。要求服务端对非 `A_contract` 状态返回 409 + error，使「禁用」是真实后端约束而非纯前端装饰。

**可观测行为**: 对 phase=`done` 的 initiative 调 fire → 返回 4xx + `error` 字段，phase 不被改动。

**验证命令**（Mode A，manual:bash，negative，捕获状态码）:
```bash
IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'done') RETURNING initiative_id" | tr -d ' ')
CODE=$(curl -s -o /tmp/fire_resp.json -w '%{http_code}' -X POST "localhost:5221/api/brain/harness/initiative/$IID/fire" -H 'Content-Type: application/json' -d '{}')
[ "$CODE" = "409" ] || [ "$CODE" = "400" ] || { echo "FAIL: 非 Gate1 点火未被拒 code=$CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/fire_resp.json || { echo "FAIL: 无 error 字段"; exit 1; }
PH=$(psql $DB -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='$IID'" | tr -d ' ')
[ "$PH" = "done" ] || { echo "FAIL: 越权点火改了 phase=$PH"; exit 1; }
echo OK
```
**硬阈值**: 非 Gate 1 fire 返回 409/400 + `error` 字符串字段，phase 保持不变

---

## 领域验证（UI 交互类 — 强制 oracle）

本 Sprint = UI 交互类（user_facing / mac_web）。合同硬条款：
- E2E 必须含可见状态断言（`toBeVisible` / `toBeDisabled` / `toHaveText`），禁止只 `page.goto` 不断言（见 ## E2E 验收）。
- 写副作用必须 DB/API 交叉校验（decision 改值 → DB 定点读；fire → 后端 phase 校验），防前端撒谎。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=mac_web Playwright）

> 由 evaluator 模式 B 在 Mac 本机执行（localhost:5174 真实 Dashboard + localhost:5221 真实 Brain）。GAN 阶段仅产出此脚本模板，proposer 不执行。
> 前置：脚本启动前用 psql 注入一个 phase=`A_contract` 的 initiative_run 及关联 decisions，并记录其 initiative id 为 `PIPELINE_ID`（用同一 id 直打详情页与三端点，口径与 Phase 2 一致）。

```javascript
// final-e2e Playwright 脚本（Mac 本机执行）
const { chromium, expect } = require('@playwright/test');
const { execSync } = require('child_process');

(async () => {
  const DB = process.env.DB || 'postgresql://localhost/cecelia';
  const BRAIN = 'http://localhost:5221';
  const psql = (sql) => execSync(`psql "${DB}" -t -c "${sql}"`).toString().trim();

  // 0. 注入 Gate 1 待决策 pipeline（phase=A_contract）+ 一条决策
  const PIPELINE_ID = psql(
    "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'A_contract') RETURNING initiative_id"
  );
  const DID = psql(
    "INSERT INTO decisions (category,topic,decision,status) VALUES ('gate1','合同断言取值','old-val','active') RETURNING id"
  );

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // 1. 打开停在 Gate 1 的详情页 → docs tab → Gate 1 决策面板展开
  await page.goto(`http://localhost:5174/harness-pipeline/${PIPELINE_ID}`);
  await page.waitForLoadState('networkidle');
  await page.click('[data-testid="docs-tab"]');
  await page.screenshot({ path: 'screenshots/01-initial.png' });
  await expect(page.locator('[data-testid="gate1-decision-panel"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="gate1-decision-item"]').first()).toBeVisible();

  // 2. 改一条决策保存 → 交叉校验 Brain DB
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

  // 5. 交叉校验后端：phase 已离开 Gate 1 进入 B_task_loop
  const r = await page.request.get(`${BRAIN}/api/brain/harness/runs/${PIPELINE_ID}/progress`);
  const d = await r.json();
  if (d.phase !== 'B_task_loop') { console.error('FAIL: 后端 phase 未离开 Gate 1', d); process.exit(1); }

  await context.close();
  await browser.close();
  console.log('✅ Gate 1 决策面板 + 点火 Golden Path UI 验证通过');
})();
```

**降级用例（非 Gate 1，单独跑）**: 注入 phase=`done` 的 pipeline，打开详情页 docs tab，断言 `gate1-fire-btn` `toBeDisabled()` 且 `gate1-fire-disabled-hint` `toBeVisible()`，面板不崩。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Gate 1 决策面板 + 改决策 + 点火 + 降级（前端） | `sprints/tests/gate1-panel.test.tsx` | 面板展示 / 改决策保存调用 PUT / 点火调用 fire / 非 Gate1 降级禁用 | → 4 failures（组件尚无 Gate 1 面板） |
