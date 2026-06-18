# Sprint Contract Draft (Round 2)

> Harness Pipeline Cockpit · Phase 2 — read-only 全生命周期视图
> journey_type: user_facing · target_environment: mac_web

## 已知约束（来自回归测试）

- [TaskPrdPage.prepprd.test.tsx] → `pickPrdContent 优先读 payload.prep_prd_body（旧字段被忽略）`（Phase 1 已固化：PrepPRD 来自 DB，非文件）
- [TaskPrdPage.prepprd.test.tsx] → `Markdown 渲染为真实 DOM 元素（h1/ul/table），非 <pre> 纯文本`
- [TaskPrdPage.prepprd.test.tsx] → `404 与网络错误态不回归`
- [HarnessPipelineDetailPage.test.ts] → 纯函数 buildGanRounds/buildStages 已有约束，本 Sprint 不得破坏其 import

## 实现目标定位（根因纠偏）

PRD「预期受影响文件」列了 `TaskPrdPage.tsx`，但**真正显示裸「文件不存在」的页面是 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 的 `SprintDocsSection`**（当前第 808 行 `文件不存在`，数据来自读 `.md` 文件的 `GET /api/brain/harness/sprint-docs`）。这正是 PRD 背景描述的「pipeline 详情页的文档区把 Prep PRD / Sprint PRD / Contract / Harness Report 全显示『文件不存在』」。

因此本 Sprint 实现落点 = `HarnessPipelineDetailPage.tsx` 的「文档」Tab：把 file-based `SprintDocsSection` 替换为 **read-only 七项全生命周期视图**，每项独立读 Brain DB/API，缺失给语义化「未到该步」占位，全页不再出现「文件不存在」。

## 数据源契约（七项 → DB/API，read-only，复用既有端点，不新增写操作）

> **两类占位语义化区分（Risk (b) mitigation，见 ## Risks）**：分区缺数据有两种根因，必须用**不同**占位文案，绝不混为一谈——
> - `未到该步`（`NOT_REACHED`）：取数**成功**但该项尚未产出（流水线没到该步 / 字段为 null / decisions 查空）。正常生命周期态。
> - `取数失败`（`FETCH_FAILED`）：该项端点**取数失败**（网络/404/500），是潜在**接线错误**信号，不能伪装成「未到该步」。
> decisions 查空是「成功但无数据」，用专属文案 `暂无决策`。

| # | 分区 key | 标签 | DB-backed 来源 | 字段 | 成功但无数据 → | 取数失败 → |
|---|---|---|---|---|---|---|
| 1 | `prep_prd` | PrepPRD | `GET /api/brain/tasks/:id` | `payload.prep_prd_body` | 未到该步 | 取数失败 |
| 2 | `sprint_prd` | 正式 PRD | `GET /api/brain/harness/initiative/:id/detail` | `prd_content` | 未到该步 | 取数失败 |
| 3 | `contract` | Contract | `GET /api/brain/harness/initiative/:id/detail` | `contract_content` | 未到该步 | 取数失败 |
| 4 | `dod` | DoD | `GET /api/brain/harness/initiative/:id/detail` | `dod_content`（独立 source 字段，**不切 contract 字符串**，见 Risk (c)）| 未到该步 | 取数失败 |
| 5 | `decisions` | 决策清单 | `GET /api/brain/decisions`（按 target=该 pipeline 的 ability/step 过滤）| 决策行数组 | 暂无决策 | 取数失败 |
| 6 | `progress` | 流水线留痕 | `GET /api/brain/harness/runs/:id/progress` + detail `step_timing` | `pct` / `current_node` / `step_timing` | 未到该步 | 取数失败 |
| 7 | `report` | Report | `report_content`（独立 source 字段，wiring 层从 detail/tasks.result 取，**不正则切 contract**，见 Risk (c)）| 未到该步 | 取数失败 |

> `:id` 语义二义性是本 Sprint 头号风险，见下方 `## Risks` (a)。任一端点 404/网络失败 → 该分区降级为 `取数失败` 占位（**非** `未到该步`），不让整页崩。

## Risks

> Reviewer Round 1 risk_registered=5 修复栏。登记 3 个真实风险 + 可机检 mitigation。

### Risk (a) — `:id` 语义二义性导致非 prep 七项全静默 404（**最高，直接打掉 PRD 核心目标**）

**风险**：两组端点对 route `:id` 的解析口径**不一致**（已读 `packages/brain/src/routes/harness.js` 核实）——
- `GET /pipeline/:planner_task_id` 与 `GET /pipeline-detail`：`WHERE id::text = $1 OR payload->>'planner_task_id' = $1`（**宽松**，OR 两路命中）。
- `GET /initiative/:id/detail`（line 208）：`WHERE id::text = $1 AND task_type = 'harness_initiative'`（**严格**，只认 initiative task 自身 id）。

若前端把路由 `:id`（可能是某 task 的 `planner_task_id` 值，而非 harness_initiative task 的自身 id）原样喂给 `/initiative/:id/detail`，后者返回 404 → `sprint_prd / contract / dod / report` 四项**全部** 404 → 若降级统一显示「未到该步」，**接线错误被静默伪装成正常占位**，反向打掉 PRD「七项产物逐项可见」核心目标。

**Mitigation（可机检）**：
1. **占位语义化分流**（同时修 Risk (b)）：404/取数失败 → 显示 `取数失败` 而非 `未到该步`，让接线错误**可见**。final-e2e 注入一个**已知有 contract/正式 PRD 的 run id**，断言 sprint_prd/contract 分区渲染**真实 DB 正文 head**（非占位）——接线接错时该断言 FAIL，不再全绿（见 ## E2E 验收 step 5/6）。
2. **id 解析单点**：lifecycle 视图取 initiative id 必须走「先 `/pipeline-detail?planner_task_id=:id` 拿回 detail 里的 `initiative_id` / task 自身 id，再用它请求 `/initiative/:id/detail`」，或锁定 `route id == initiative task 自身 id`（实现时二选一，写进 `lifecycle.ts` 注释 + DOM 测试覆盖「id 不匹配时分区显示 取数失败 而非 未到该步」）。

### Risk (b) — 降级占位掩盖真实接线失败

**风险**：PRD 边界情况要求「取数失败 → 降级占位不崩页」，但若失败与「未产出」用**同一**占位文案，则 generator 把端点接错（或根本没接）时，页面照样显示「未到该步」一片绿，QA/Reviewer 无从分辨「真未到该步」与「接线坏了」。

**Mitigation（可机检）**：两个占位常量字面分离——`NOT_REACHED='未到该步'`（取数成功但无数据）vs `FETCH_FAILED='取数失败'`（端点失败）。`selectSectionContent(key, {errors:{[key]:true}})` 必须返回 `FETCH_FAILED`，纯逻辑测试 `取数失败与未到该步占位分流` 断言二者**不相等**。

### Risk (c) — DoD/Report「同源/result 抽取」字符串解析脆弱

**风险**：Round 1 把 DoD 取自「`contract_content` 内 DoD 段」、Report 取自「detail/tasks.result 中的报告」。若实现用**正则/字符串切分**从 contract 大块文本里抠 DoD 段、或从 result JSON 里猜字段，解析脆弱——contract 格式一变就抠错段、result 结构一变就 silently 取空，产生「看似有内容实则错位」的脏渲染。

**Mitigation（可机检）**：DoD 与 Report 各用**独立 source 字段**（`dodContent` / `reportContent`），由 wiring 层显式赋值；`selectSectionContent` 是**纯映射**（key → 其专属 source 字段），**内部不做任何 contract 字符串切段 / result 结构猜测**。Brain 暂无独立 DoD/Report 字段时，wiring 层显式传 `null` → `未到该步`，**绝不用正则切 contract 冒充**。纯逻辑测试断言 `selectSectionContent('dod', {contractContent:'...'})`（只给 contract、不给 dodContent）返回 placeholder（证明不会从 contract 偷内容冒充 DoD）。

---

## Response Schema（推导来源: PRD 字面）

**N/A — 本 Sprint 无新增 HTTP 端点**：纯前端 read-only 渲染改动，复用既有 Brain 端点（上表）。不定义新响应 schema，Reviewer 第 6 维 verification_oracle_completeness 中「新端点 schema」项不适用；oracle 完整性由下方七项 [BEHAVIOR] 渲染断言承载。

---

## Golden Path

[打开 /pipeline/:id 详情页] → [按生命周期顺序逐项拉 Brain DB/API] → [七项分区：有数据 Markdown 渲染 / 未到该步占位，全页无「文件不存在」]

### Step 1: 用户打开任意 harness run / pipeline 详情页
**来源**: `[FROM_PRD]` — Golden Path 第 1 点「用户打开任意 harness run / pipeline 的详情页（带 run/task id）」

**可观测行为**: 页面加载不崩，文档区按生命周期顺序展示七项分区标题（PrepPRD / 正式 PRD / Contract / DoD / 决策清单 / 流水线留痕 / Report）。

**验证命令**:
```bash
# 纯函数契约：七项分区按序存在（sprint 测试经 packages/brain symlink 运行，与 CI brain-unit 一致）
cd packages/brain && npx vitest run sprints/06181500-cockpit-phase2-lifecycle/tests/lifecycle-contract.test.ts -t "七项分区按生命周期顺序"
# 期望：exit 0（LIFECYCLE_SECTIONS 含 7 项且 key 顺序为 prep_prd→sprint_prd→contract→dod→decisions→progress→report）
```

**硬阈值**: `LIFECYCLE_SECTIONS.length === 7` 且 key 顺序精确匹配
**验证命令**: 同上（vitest -t 选择该用例，断言失败时非 0 exit）

---

### Step 2: 每项独立从 Brain 取数（不读本地 .md），PrepPRD 显示完整全文 Markdown
**来源**: `[FROM_PRD]` — Golden Path 第 2 点「每项独立从 Brain 取数（不读本地 .md 文件）」+ 「PrepPRD 来自 payload.prep_prd_body 完整全文 Markdown 渲染」

**可观测行为**: PrepPRD 分区把 `payload.prep_prd_body` 的完整 Markdown 渲染为真实 DOM（h1/列表/表格），而非 `<pre>` 原文，也非读文件。

**验证命令**:
```bash
# DOM 级（happy-dom）：PrepPRD 全文来自 DB，Markdown 渲染
(cd apps/dashboard && npx vitest run src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx -t "PrepPRD 显示 DB 全文并 Markdown 渲染")
# 期望：exit 0（断言 prep_prd_body 全文片段 toBeInTheDocument，且 # 标题渲染成 <h1>，无字面 '# ' 残留）
```

**硬阈值**: PrepPRD 分区 DOM 含 `prep_prd_body` 全文文本节点，且存在 `role=heading level=1`
**验证命令**: 同上（DOM 测试内含 `getByRole('heading',{level:1})` 显式断言）

---

### Step 3: 有数据项 Markdown 渲染、未产出项显示「未到该步」占位
**来源**: `[FROM_PRD]` — Golden Path 第 3 点「任一项有数据 → Markdown 渲染该项内容；任一项尚未产出 → 显示『未到该步』占位」+ 边界情况「仅完成前几步 → 已完成项渲染，未完成项一律『未到该步』」

**可观测行为**: 给「PrepPRD 有内容 + Report 未产出」的混合数据，PrepPRD 渲染内容、Report 分区显示「未到该步」；`decisions` 查无 → 「暂无决策」。

**验证命令**:
```bash
# 纯函数契约：占位选择逻辑
cd packages/brain && npx vitest run sprints/06181500-cockpit-phase2-lifecycle/tests/lifecycle-contract.test.ts -t "缺失项返回未到该步占位"
# 期望：exit 0（selectSectionContent 缺源→{kind:'placeholder',text:'未到该步'}；decisions 空→'暂无决策'；有源→{kind:'markdown'}）
```

**硬阈值**: `NOT_REACHED === '未到该步'`；缺源项 `kind==='placeholder'`；有源项 `kind==='markdown'`
**验证命令**: 同上

---

### Step 4: 全页不出现裸「文件不存在」死字
**来源**: `[FROM_PRD]` — Golden Path 可观测结果第 4 点「全页**不出现**裸『文件不存在』字样」（PRD 核心验收点）

**可观测行为**: 无论各项有无数据，渲染出的 DOM 文本中**不含**「文件不存在」；缺失一律走语义化占位。

**验证命令**:
```bash
# DOM 级：断言「文件不存在」缺席
(cd apps/dashboard && npx vitest run src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx -t "全页不出现文件不存在死字")
# 期望：exit 0（混合数据下 queryByText('文件不存在') === null，且占位文案为「未到该步」/「暂无决策」）
# 源码守卫：lifecycle 视图源码不得保留旧死字（除被删除的 file-based 段）
! grep -n "文件不存在" apps/dashboard/src/pages/harness-pipeline/lifecycle.ts && echo "OK: 生命周期模块无死字"
```

**硬阈值**: DOM `queryByText('文件不存在')` 为 null；`lifecycle.ts` 不含「文件不存在」
**验证命令**: 同上（DOM 负向断言 + grep 反向守卫，grep 命中即非 0 exit）

---

### Step 5: 单项 Brain API 取数失败 → 该分区降级为「取数失败」占位（区别于「未到该步」），整页不崩
**来源**: `[FROM_PRD]` — 边界情况第 3 点「某项 Brain API 取数失败（网络/404）→ 该分区降级为占位文案，不让整页崩」；占位文案分流为 `[AI_ADDED]`（Risk (a)/(b) mitigation，理由：取数失败若与「未到该步」同文案，会把接线错误静默伪装成正常占位，打掉 PRD「七项逐项可见」核心目标）

**可观测行为**: 模拟某端点 reject/404，对应分区显示 **`取数失败`**（**不是** `未到该步`），其余分区与页面正常渲染（无未捕获异常、无白屏）。

**验证命令**:
```bash
(cd apps/dashboard && npx vitest run src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx -t "单项取数失败降级占位不崩页")
# 期望：exit 0（某 fetch reject → 该分区 placeholder「取数失败」，页面其余分区仍 toBeVisible）
```

**硬阈值**: 失败分区 `kind==='placeholder'` 且 `text==='取数失败'`（≠「未到该步」）；页面根容器仍渲染（其余分区可见）
**验证命令**: 同上 + 纯函数 `selectSectionContent(key,{errors:{[key]:true}})` → `{kind:'placeholder',text:'取数失败'}`（lifecycle-contract.test.ts `取数失败与未到该步占位分流` 覆盖）

---

### Step 6（AI 防造假）: PrepPRD 渲染内容等于真实 DB body，禁止硬编码
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：防止 generator 用一段写死的占位 Markdown 假冒「PrepPRD 全文」骗过 Step 2，断言渲染文本必须等于 mock 注入的 `payload.prep_prd_body` 唯一指纹串，确保数据真来自 DB 字段而非硬编码。

**可观测行为**: mock 的 `prep_prd_body` 含唯一指纹（如 `PREP-PRD-FINGERPRINT-{uuid}`），渲染 DOM 必须出现该指纹；换一个指纹值，渲染随之变化。

**验证命令**:
```bash
(cd apps/dashboard && npx vitest run src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx -t "PrepPRD 渲染等于DB注入指纹非硬编码")
# 期望：exit 0（注入指纹串出现在 DOM；不存在与 fixture 无关的写死正文）
```

**硬阈值**: 注入指纹 `toBeInTheDocument`
**验证命令**: 同上

---

## E2E 验收（最终 final-e2e 跑 — target_environment = mac_web）

**journey_type**: user_facing
**target_environment**: mac_web（本机 Playwright，localhost:5174）

> 由 evaluator 在 Mac 本机执行。`PIPELINE_ID` 由 evaluator 注入一个**已跑到 contract 收敛**的 harness run id——即 `/api/brain/harness/initiative/:id/detail` 必须返回**非空** `prd_content` **与** `contract_content`（证明非 prep 分区真实 DB 接线，修 Reviewer Round 1 verification_oracle_completeness=6）。该 run 同时有 PrepPRD、但未跑到 Report（覆盖「部分完成」边界）。
> **关键（Risk (a)/(b) oracle）**：脚本先 `page.request.get(/initiative/:id/detail)` 取真实 `prd_content`/`contract_content` head，再 `toContainText(head)` 断言对应分区渲染了**真实 DB 正文**——若 `:id` 接线接错（`/initiative/:id/detail` 404）或分区降级，分区会显示 `取数失败` 占位，head 断言 FAIL，**不再全绿**。

```javascript
// final-e2e Playwright 脚本（Mac 本机，localhost:5174）
const { chromium, expect } = require('@playwright/test');

(async () => {
  const PIPELINE_ID = process.env.PIPELINE_ID;
  if (!PIPELINE_ID) { console.error('FAIL: 缺 PIPELINE_ID'); process.exit(1); }

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // 0. 前置：注入的 run 必须真有 contract/正式 PRD（否则本 oracle 无意义 → FAIL，逼 evaluator 注入正确 run）
  const detailResp = await page.request.get(`http://localhost:5221/api/brain/harness/initiative/${PIPELINE_ID}/detail`);
  if (!detailResp.ok()) { console.error(`FAIL: /initiative/${PIPELINE_ID}/detail 非 200（接线错误 Risk(a)）status=${detailResp.status()}`); process.exit(1); }
  const detail = await detailResp.json();
  const prdContent = detail?.prd_content;
  const contractContent = detail?.contract_content;
  if (!prdContent || !contractContent) { console.error('FAIL: 注入 run 缺 prd_content/contract_content，无法校验非 prep 分区真实接线'); process.exit(1); }
  const head = (s) => s.replace(/^#+\s*/, '').split('\n')[0].slice(0, 12);

  // 1. 打开 pipeline 详情页 → 文档 Tab
  await page.goto(`http://localhost:5174/pipeline/${PIPELINE_ID}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });
  await page.getByTestId('docs-tab').click();
  await page.screenshot({ path: 'screenshots/02-action.png' });

  // 2. PrepPRD 分区显示完整全文（来自 DB），Markdown 有格式（存在标题元素）
  const prep = page.getByTestId('lifecycle-section-prep_prd');
  await expect(prep).toBeVisible({ timeout: 10000 });
  await expect(prep.locator('h1, h2').first()).toBeVisible();

  // 3. 【新增 oracle — 修 verification_oracle_completeness=6】非 prep 分区交叉校验真实 DB 内容：
  //    sprint_prd 分区必须渲染 /initiative/:id/detail 的 prd_content head（非占位）
  const prdSection = page.getByTestId('lifecycle-section-sprint_prd');
  await expect(prdSection).toBeVisible();
  await expect(prdSection).toContainText(head(prdContent));
  await expect(prdSection).not.toContainText('取数失败');
  await expect(prdSection).not.toContainText('未到该步');

  //    contract 分区必须渲染 contract_content head（非占位）
  const contractSection = page.getByTestId('lifecycle-section-contract');
  await expect(contractSection).toBeVisible();
  await expect(contractSection).toContainText(head(contractContent));
  await expect(contractSection).not.toContainText('取数失败');

  // 4. 未产出项（Report）显示「未到该步」占位（成功但无数据），而非「文件不存在」「取数失败」
  const report = page.getByTestId('lifecycle-section-report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('未到该步');

  // 5. 全页 DOM 文本不出现「文件不存在」
  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes('文件不存在')) { console.error('FAIL: 页面出现「文件不存在」死字'); process.exit(1); }
  await page.screenshot({ path: 'screenshots/03-result.png' });

  // 6. 交叉验证 PrepPRD 渲染文本来自 tasks 端点 payload.prep_prd_body
  const apiResp = await page.request.get(`http://localhost:5221/api/brain/tasks/${PIPELINE_ID}`);
  if (apiResp.ok()) {
    const data = await apiResp.json();
    const body = data?.payload?.prep_prd_body;
    if (body) await expect(prep).toContainText(head(body));
  }

  await context.close();
  await browser.close();
  console.log('✅ Golden Path 全生命周期 UI 验证通过（PrepPRD + 正式PRD + Contract 三项真实 DB 接线已交叉校验）');
})();
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 生命周期映射纯逻辑 | `tests/lifecycle-contract.test.ts`（proposer 红，node env） | 七项顺序 + 占位选择 + 失败降级 + 无「文件不存在」 | → import 失败 / 断言失败（lifecycle.ts 未实现）|
| 生命周期 DOM 渲染 | `apps/dashboard/src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx`（generator 写，happy-dom） | PrepPRD 全文 / 占位 / 无死字 / 降级 / 防硬编码 | → 组件未改前断言失败 |
