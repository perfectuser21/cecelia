# Sprint Contract Draft (Round 1) — 系统总图页上线（map 投影现算 + mind-elixir 三层脑图）

> journey_type: user_facing ｜ target_environment: mac_web
> 锚定: gp_id=butler/g1_command_deck, step_id=keep-green, journey_id=8bb8252f-29b4-4c34-acb9-1accda7ddfcf
> contract-gate: present (cecelia worktree, 代码层 Contract Gate 生效)
> gp-anchor: skipped (product-map.json not found — cecelia 仓无 product-map/generated/product-map.json)
> map radius: [MAP_NOT_CONFIGURED]（task.payload.map_repo 为 null，map_scope=["G1"]，本轮不跑 radius 现算，无 must_run_assertions 注入）

## 现状事实（起草前实测，SSOT）

- `apps/api/features/planning/pages/MapPage.tsx` **已存在且已现算 live fetch**：`GET /api/brain/map?scope=<scope>` → 渲染 `通用地图` 语义 DOM（`{summary.value_streams} 条价值流`、`{summary.capabilities} 个 Capability`、Level 1/2/3 下钻、freshness 徽标）。
- `apps/dashboard/src/pages/map/MapPage.test.tsx` 为**权威回归测试，当前 4/4 全绿**（本轮实测），它锁定的是上述语义 DOM，且断言 `apps/dashboard/src/pages/map/MapPage.tsx` 不存在（唯一 /map 由 planning manifest 注册）。
- `mind-elixir` **当前不在仓库任何位置**（`grep -rn mind-elixir apps/ package.json` 空）。
- 实测 `GET /api/brain/map?scope=cecelia` → `summary={value_streams:2, capabilities:11}`，`freshness.status=fresh`；`?scope=zenithjoy-workspace` → `{value_streams:5, capabilities:20}`；缺 scope → HTTP 400。

**结论**：本 sprint 的净增量 = 在**不删改现有语义 DOM / 不破坏权威测试**的前提下，**additive** 叠加 mind-elixir 三层可折叠脑图（价值流→能力→特性）+ 纯函数 view-model + `apps/dashboard/package.json` 依赖。这是 keep-green 锚定的唯一自洽解：若把渲染替换成 mind-elixir 会使权威测试的 DOM 断言（`11 个 Capability`、下钻按钮、`Level 2/3` 文案）全部失效 → 违反 PRD「范围内：MapPage.test.tsx 保持通过」硬约束。

## Response Schema（推导来源: N/A — 不新增 HTTP 端点）

N/A — 本 sprint 不新增/不修改任何 HTTP 端点，仅**消费**现有 `GET /api/brain/map?scope=<scope>`（现算，后端逻辑不动）。消费到的响应形状（作参考，非本 sprint 交付）：`{ scope_key, manifest_version, projection_digest, fact_revisions, freshness:{status,reason_code}, nodes[], edges[], summary:{value_streams,capabilities,boundaries,crosscuts,prerequisites} }`。Reviewer 第 6 维（新端点 schema 完整性）对本 sprint 自动满分。

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试 apps/dashboard/src/pages/map/MapPage.test.tsx] → 只从动态 feature manifest 注册唯一 /map 页面（planning manifest，`apps/dashboard/src/pages/map/MapPage.tsx` 必须不存在）
- [回归测试 同上] → Level 1 展示冻结清单/投影元数据/横切件/不适用前置；`11 个 Capability`/`2 条边界`/`7 项横切件` 文案与 summary 一致
- [回归测试 同上] → 从 Capability 下钻 Feature/Assertion → 显示真实 receipt（PASS / source_sha / completed_at）
- [回归测试 同上] → 第二个 scope（zenithjoy-workspace）证据缺 receipt 时回退到该 repo revision
- [累积FR] context-manifest: unavailable（本 line 无累积 FR，PRD 段亦为空）

## 锚定父路声明

覆盖父路 butler/g1_command_deck 第 keep-green 步（管家指挥台 G1「统一查询」的可视化出口；本 sprint 为 keep-green 增量，不回退父路已绿行为）。

## Golden Path

[打开 /#/map] → [现算 fetch + 语义 DOM(既有) + mind-elixir 三层脑图(新增) 渲染] → [scope 切换重新现算重渲染] → [看到与 API summary 一致的价值流/能力/特性全景 + freshness 徽标]

---

### Step 1: 用户打开总图页，现算 fetch 并渲染既有语义全景（keep-green）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步（浏览器打开 localhost:5174/#/map，直连 GET /api/brain/map?scope=cecelia 现算拉取）

**可观测行为**: 页面出现 `通用地图` 标题；`2 条价值流`、`11 个 Capability` 数字与 `GET /api/brain/map?scope=cecelia` 的 `summary` **动态一致**（页面读数 == API 读数，非硬编码）。

**验证命令**:
```bash
S=$(curl -sf "localhost:5221/api/brain/map?scope=cecelia")
echo "$S" | jq -e '.summary.value_streams==2 and .summary.capabilities==11' || { echo "FAIL: API summary 非 2/11"; exit 1; }
```
**硬阈值**: API `summary.value_streams==2` 且 `capabilities==11`；页面 DOM 文案 `${capabilities} 个 Capability` 与 API 同值（E2E 交叉验证，见 ## E2E 验收）。

---

### Step 2: mind-elixir 三层可折叠脑图（新增 additive 层，价值流→能力→特性）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步「用 mind-elixir 渲染三层可折叠脑图」+ 范围内「依赖 mind-elixir 加进 apps/dashboard/package.json」

**可观测行为**: 页面出现 `data-testid="map-mindmap"` 容器且真实浏览器下渲染出 mind-elixir 脑图节点（根=scope，一级=价值流，二级=能力，三级=特性）；三层结构由**纯函数 view-model** `buildMindmapTree(nodes, edges)` 从 live map 的 `contains` 边推导（`backbone` 中间层折叠，特性=能力经 contains 可达的 `feature` 型节点）。**既有语义 DOM 全部保留**（权威测试 4/4 不回归）。

**验证命令**:
```bash
# 纯函数 view-model 结构（本 sprint 冻结测试，root vitest）
cd /workspace && npx vitest run sprints/08241956-kernel-9daed395/tests/map-mindmap.test.ts --reporter=dot
```
**硬阈值**: 冻结测试通过（2 个价值流根、能力挂在其价值流下、特性挂在能力下三层嵌套）；`apps/dashboard/package.json` 含 `mind-elixir`。

---

### Step 3: 权威回归测试保持全绿（mind-elixir 必须 additive 且 jsdom-safe）
**来源**: `[AI_ADDED]` — 理由：mind-elixir 若替换渲染或在 jsdom 中崩溃会击穿权威测试，此步把「不回归」codify 成可执行断言，防止对抗性适应（把现有断言删空冒充绿）。

**可观测行为**: `apps/dashboard/src/pages/map/` 下测试全绿；mind-elixir 的 `init()` 在 jsdom（无 canvas/getBoundingClientRect）中被安全 guard（try/feature-detect），不抛出使 `render(<MapPage/>)` 崩溃。

**验证命令**:
```bash
cd /workspace/apps/dashboard && npx vitest run src/pages/map/ --reporter=dot
```
**硬阈值**: 退出码 0，权威 `MapPage.test.tsx` 原有 4 条断言全过（不得删改其断言内容）。

---

### Step 4: Scope 切换现算重渲染，旧脑图不残留（last-write-wins）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 边界情况「in-flight 请求以最后一次选择为准」

**可观测行为**: 把 Scope 从 `cecelia` 切到 `zenithjoy-workspace` 并点「加载」→ 页面重新 `GET /api/brain/map?scope=zenithjoy-workspace` 并重渲染；数字变为该 scope 的 `summary`（实测 `5 条价值流`、`20 个 Capability`），无 cecelia 旧脑图残留。

**验证命令**:
```bash
Z=$(curl -sf "localhost:5221/api/brain/map?scope=zenithjoy-workspace")
echo "$Z" | jq -e '.summary.value_streams>=1 and .summary.capabilities>=1' || { echo "FAIL: zj summary 空"; exit 1; }
```
**硬阈值**: 切换后页面 DOM `${value_streams} 条价值流` == zj API 值（E2E 交叉验证）；无旧 scope 数字残留。

---

### Step 5: freshness 徽标可见；非 fresh 出现可见提示（不静默）
**来源**: `[FROM_PRD]` — PRD 边界情况「freshness 非 fresh → 徽标区必须出现可见提示文案，不得静默」；ASSUMPTION：live=fresh，非 fresh 由 stale mock 单测覆盖

**可观测行为**: fresh 时徽标区显示 `新鲜`（live E2E 真断言 fresh 路径）；`freshness.status !== 'fresh'` 时页面出现可见提示元素（`role="status"` 或明显警示文案，非仅内部 reason_code），由 dashboard 侧 stale mock 单测覆盖。

**验证命令**:
```bash
S=$(curl -sf "localhost:5221/api/brain/map?scope=cecelia")
echo "$S" | jq -e '.freshness.status=="fresh"' || { echo "FAIL: live 非 fresh，E2E fresh 断言前提不成立"; exit 1; }
```
**硬阈值**: live freshness=fresh；非 fresh 提示可见性由 stale mock 单测（dashboard vitest）断言。

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」链路；仅浏览器同源 `GET /api/brain/map?scope=<scope>`（无认证头/无 body，query 参数 `scope`）。

## 禁 mock 边清单

- （本单为**纯前端 UI + 纯函数 view-model** 改动，无调度/状态机/DB 写路径/跨模块数据接力/生命周期钩子接缝，故无「被改的边」需强制真调）
- 说明：页面消费的 `GET /api/brain/map` 现算边是**外部 HTTP 边界**，在 mode B E2E（mac_web 真浏览器 + 真 Brain）**真调不 mock**；view-model 冻结单测用固定 fixture（外部 API 边界，允许 mock）；dashboard 侧 jsdom 组件测按仓库既有约定 mock `global.fetch`（既有权威测试同款，非本单新引入的接缝 mock）。

## 未覆盖真实链路清单

- mind-elixir 真实 `init()` 渲染 | jsdom 无 canvas/布局 API，组件单测中 mind-elixir 挂载被 guard 跳过 | 补位：mode B mac_web Playwright 真浏览器 E2E 断言 `[data-testid="map-mindmap"]` 可见且含渲染节点（本轮 evaluator 执行）
- live freshness=非 fresh 路径 | live 环境实测 freshness=fresh，无法在 live E2E 触发 stale | 补位：dashboard vitest stale mock 单测断言非 fresh 提示可见（本轮交付）
- zenithjoy-workspace 数据正确性 | PRD 明确不在范围（本 sprint 只保证切换能现算重渲染）| 补位：不补位，按 PRD 范围外登记

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR** | 系统承诺 | /map 页在既有语义全景基础上叠加 mind-elixir 三层脑图（价值流→能力→特性），live 现算，scope 可切换重渲染 |
| **NFR** | 性能/可靠性 | PRD 未指定超时/频控（待定）；不得引入本地缓存掩盖 freshness；mind-elixir 需 MIT 许可 |
| **Invariant** | 永不违反 | 权威 `MapPage.test.tsx` 4/4 不回归；唯一 /map 仍由 planning manifest 注册；不新建顶层目录；实现只落 planning + apps/dashboard/package.json |
| **判定点** | 模糊现实判断 | 见判定点登记表 |
| **保质期** | 何时过期 | mind-elixir 依赖版本随 apps/dashboard 常规升级；map 数据现算无缓存，无独立保质期 |
| **死亡告警** | 停了谁知道 | /map 页渲染失败由权威回归测试 + mac_web E2E 在 CI/evaluator 阶段拦截 |
| **失败语义** | 挂了怎么办 | 见失败语义声明 |
| **效果确认** | 已发≠已生效 | E2E 交叉验证：页面 DOM 读数 == 同一次 API summary 读数（动态比对，非硬编码） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳 | 静默丢消息 |
| 投影是否「非最新」（freshness 提示是否该出现） | A. envelope.freshness.status !== 'fresh'; B. 逐 repo snapshot stale 聚合 | A（envelope.freshness.status） | 后端已聚合 status 为权威字段，前端只做展示不重算 | 误判 fresh→展示陈旧地图当最新，用户被误导（非静默丢数据，可由徽标 reason_code 追溯） |
| 三层归属（某 capability 属于哪条价值流 / 某 feature 属于哪个 capability） | A. contains 边溯源折叠 backbone; B. display_order 猜测 | A（沿 contains 边推导，折叠 backbone 中间层） | 与既有页面 capabilityForStream 溯源一致，避免自创层级 | 节点挂错父层，脑图结构失真（可视，非面客错误） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写库 | 是（task_id 幂等） | 客户端重试 |
| GET /api/brain/map 失败/超时 | 页面显示 `role="alert"` 错误条（既有行为保留），不渲染脑图 | 是（纯读，可重新点加载） | 展示错误，不缓存旧数据 |
| 某 scope 返回空 nodes/edges | 空态占位，脑图容器不崩溃 | 是 | 空态提示 |
| mind-elixir init 在 jsdom 失败 | guard 跳过挂载，语义 DOM 照常渲染 | 是 | feature-detect 降级，仅真浏览器挂载脑图 |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent/爬虫入库/外部可写接口；仅只读消费同源现算 API。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: Scope 输入框填非法 scope（如 `not-a-scope`、空格、超长字符串）→ 页面应显示错误条/空态，不白屏、不崩溃
- 重复提交: 快速连点两次「加载」或连续切换 scope → in-flight 竞态，以最后一次为准，旧脑图不覆盖新脑图
- 中途中断: 切换 scope 加载中刷新页面（`#/map`）→ 重进后现算重拉，不残留半渲染脑图
- 边界值: 切到 nodes/edges 为空的 scope → 脑图容器空态占位不报错；capabilities=0 时覆盖条显示 0
发现分级: P0/P1（白屏/脑图崩溃/旧 scope 数据残留冒充新 scope）→ 阻塞 merge；P2/P3（样式/空态文案）→ 记 findings 不阻塞

## E2E 验收（final-e2e 跑 — target_environment=mac_web）

**journey_type**: user_facing
**target_environment**: mac_web（本机 Playwright，dashboard localhost:5174 + Brain localhost:5221 现算，evaluator 独立 task 执行）

> 说明：evaluator 的 mac_web 环境已起 dashboard(5174) 与 Brain(5221)。以下单个 bash 块：用 page.request 现算读取 API summary，再断言页面 DOM 读数与之动态一致（非硬编码），并断言 mind-elixir 容器真实渲染、scope 切换重渲染、freshness 徽标可见。截图存 `${SPRINT_DIR}/screenshots/`。

```bash
set -euo pipefail
SPRINT_DIR="${SPRINT_DIR:-sprints/08241956-kernel-9daed395}"
mkdir -p "$SPRINT_DIR/screenshots"
cd /workspace/apps/dashboard
cat > /tmp/map-e2e.mjs <<'PWEOF'
import { chromium } from '@playwright/test';
const SHOTS = process.env.SHOTS_DIR;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Step1: open /#/map, wait for live render
  await page.goto('http://localhost:5174/#/map');
  await page.getByRole('heading', { name: '通用地图' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/01-initial.png` });
  // cross-check page counts == live API summary (dynamic, not hardcoded)
  const api = await (await page.request.get('http://localhost:5221/api/brain/map?scope=cecelia')).json();
  const vs = api.summary.value_streams, caps = api.summary.capabilities;
  if (vs !== 2 || caps !== 11) { console.error('FAIL: cecelia summary drift', vs, caps); process.exit(1); }
  await page.getByText(`${vs} 条价值流`).waitFor({ timeout: 10000 });
  await page.getByText(`${caps} 个 Capability`).waitFor({ timeout: 10000 });
  // Step2/3: mind-elixir additive container rendered with nodes
  const mind = page.locator('[data-testid="map-mindmap"]');
  await mind.waitFor({ state: 'visible', timeout: 10000 });
  const topicCount = await mind.locator('*').count();
  if (topicCount < 1) { console.error('FAIL: mind-elixir container empty'); process.exit(1); }
  // Step5: freshness badge visible (live=fresh)
  await page.getByText('新鲜').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/02-action.png` });
  // Step4: scope switch -> re-fetch + re-render, no stale residue
  await page.getByLabel('Scope').fill('zenithjoy-workspace');
  await page.getByRole('button', { name: '加载' }).click();
  const zj = await (await page.request.get('http://localhost:5221/api/brain/map?scope=zenithjoy-workspace')).json();
  const zvs = zj.summary.value_streams, zcaps = zj.summary.capabilities;
  await page.getByText(`${zvs} 条价值流`).waitFor({ timeout: 15000 });
  await page.getByText(`${zcaps} 个 Capability`).waitFor({ timeout: 10000 });
  // stale-residue guard: old cecelia count must be gone when it differs
  if (caps !== zcaps) {
    const leftover = await page.getByText(`${caps} 个 Capability`).count();
    if (leftover > 0) { console.error('FAIL: 旧 scope 数字残留'); process.exit(1); }
  }
  await page.screenshot({ path: `${SHOTS}/03-result.png` });
  await browser.close();
  console.log('OK: mac_web /map golden path e2e passed');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
PWEOF
SHOTS_DIR="$SPRINT_DIR/screenshots" node /tmp/map-e2e.mjs
```

**通过标准**: 脚本 exit 0，三张截图产出，页面读数与 API summary 动态一致，mind-elixir 容器可见非空，scope 切换重渲染无残留。

## staging 预览闸（user_facing 专属 — cecelia 仓通知式）

### 步骤 A：落 staging
- cecelia staging 环境 `localhost:5212`（引用现有 staging 部署脚本，不重造）；dashboard 构建产物部署到 staging，/#/map 可达。

### 步骤 B：Final E2E 在 staging 跑 + 截图
- 上述 `## E2E 验收` 脚本以 `BASE_URL` 指向 staging（`http://localhost:5212`）执行；截图存 `${SPRINT_DIR}/screenshots/staging-<step>.png`。

### 步骤 C：Bark 推主理人预览链接（通知式）
- 调 `$BARK_URL` 通知主理人，附 staging /#/map 预览链接 + 截图 URL，注明「24h 无异议自动放行」。
- Brain PATCH 写 promote 时间戳：
```bash
curl -X PATCH localhost:5221/api/brain/tasks/$TASK_ID -H "Content-Type: application/json" \
  -d '{"metadata":{"staging_deployed":true,"promote_after":"<UTC+24h>","staging_url":"http://localhost:5212/#/map"}}'
```

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| mind-elixir 三层脑图 view-model | `sprints/08241956-kernel-9daed395/tests/map-mindmap.test.ts` | `buildMindmapTree 从 contains 边推导 2 个价值流根`、`能力挂在其价值流下`、`特性经折叠 backbone 挂在能力下（三层嵌套）` | → 3 failures（`buildMindmapTree` 未实现，import 解析失败/函数不存在） |
| 权威页面回归（补充行，既有） | `apps/dashboard/src/pages/map/MapPage.test.tsx` | 唯一 /map 注册、Level1 全景、下钻 receipt、第二 scope 回退 | 既有 4/4 绿（回归护栏，非本轮新红） |

> 冻结测试 = 第一行 `sprints/08241956-kernel-9daed395/tests/map-mindmap.test.ts`（本轮落盘并进 commit）。第二行为 repo 既有权威测试，仅作 keep-green 补充行。
