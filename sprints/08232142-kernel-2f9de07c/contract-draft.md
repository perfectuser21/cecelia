# Sprint Contract Draft (Round 1)

## Notes 与证据来源

- authoritative implementation baseline: `perfectuser21/cecelia@422633217348366974b6c28ceeaba7f587070a51`；本合同不得以角色 checkout SHA 替换它。
- `[MAP_NOT_CONFIGURED]`：task payload 的 `map_scope` 是数组且 `map_repo` 缺失，无法按 Unified Map radius 协议取得 `must_run_assertions`；不回退到硬编码 radius。
- live map 证据（2026-08-23）：`cecelia` 返回 2 条 value stream、11 个 capability；`zenithjoy-workspace` 返回 5 条 value stream、20 个 capability。数量仅作基准偏差报告，页面真值始终来自同次响应。
- `fact_revisions` / `freshness` 证据来自 `GET /api/brain/map?scope=<scope>`；`cecelia.fact_revisions.cecelia` 当前指向冻结 implementation baseline。
- context-manifest: unavailable（端点未返回可用正文）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 字面 + 现有 `/api/brain/map` live 响应）

### Endpoint: GET /api/brain/map?scope=cecelia|zenithjoy-workspace

成功响应必须保留现有 API 字面字段：`scope_key`、`manifest_version`、`manifest_digest`、`projection_digest`、`fact_revisions`、`generated_at`、`freshness`、`nodes`、`edges`、`summary`、`shared_prerequisites`。页面只读取、不改变响应契约。

- `freshness.status` (string, 必填)：非 `fresh` 必须持续显示警告。
- `nodes` (array, 必填)：节点的 `key/type/name/attributes/state` 驱动渲染。
- `edges` (array, 必填)：`contains/implements/proves/serves/owned_by/hands_off_to` 驱动层级、证明和关系。
- `summary.value_streams` / `summary.capabilities` (number, 必填)：页面统计必须与同次响应相等。
- 禁用字段名：N/A（PRD 禁止改变 Brain API 响应契约，未定义替代字段）。
- 错误响应：页面不得把非 2xx、解析失败或缺少 `nodes/edges` 的响应展示为成功投影。

## 已知约束（来自回归测试）

- `apps/dashboard/src/pages/map/MapPage.test.tsx` → 只从 dynamic planning manifest 注册唯一 `/map` 页面。
- `apps/dashboard/src/pages/map/MapPage.test.tsx` → Level 1 展示投影元数据、横切件及共享前置状态。
- `apps/dashboard/src/pages/map/MapPage.test.tsx` → 从 Capability 下钻到 Feature/Assertion 并显示 receipt。
- `apps/dashboard/src/pages/map/MapPage.test.tsx` → 第二 scope 缺 receipt 时回退到该 repo revision。
- `apps/dashboard/src/pages/map/MapPage.auth.test.tsx` → 公共 Dashboard 不暴露内部 map rebuild 操作。
- `[累积FR]` 本 line 暂无历史已验收行为。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 从 system-hub 可达 live 系统总图；支持双 scope、三层探索、搜索、证明、关系和状态反馈。 |
| NFR（做得多好） | scope 切换不得串数据；加载/空/错误/非 fresh 状态可见；交互响应预算 10 秒。 |
| Invariant（永不违反） | 不修改 map 生成算法或响应契约；不展示静态演示数据；不暴露重建入口。 |
| 判定点（怎么知道） | 页面显示值逐项对照同次真实 API 响应；非 fresh 以 `freshness.status !== "fresh"` 判定。 |
| 保质期（何时过期） | 每次进入或切换 scope 重新取 live 投影；旧 scope 响应在 scope 改变后立即失效。 |
| 死亡告警（停了谁知道） | 用户在一次请求预算内看到错误态和重试入口；本 sprint 不新增后台告警。 |
| 失败语义（挂了怎么办） | fail closed：失败、无数据、非法响应均不展示成功投影；允许显式重试。 |
| 效果确认（已发≠已生效） | UI 统计、层级、关系、freshness 与浏览器同次 API 响应交叉核对并截图。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 当前 scope 投影是否生效 | A. 看 select；B. 页面值与该 scope 同次 API 响应逐项对照 | B | 可抓出旧请求覆盖新 scope | 用户看到错误系统状态 |
| 投影是否非新鲜 | A. 比较时间；B. 读取 `freshness.status` | B | API 是 freshness 权威 | 陈旧投影被误认成实时状态 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| map API 非 2xx/非法 JSON | 显示错误，不渲染成功投影 | 是（GET） | 保留重新请求入口 |
| scope 快速切换发生乱序 | 丢弃旧 scope 响应 | 是（GET） | 加载态维持到当前 scope 完成 |
| 节点或关系为空 | 显示对应空状态 | 是 | 其余有效层级继续可浏览 |

### 输入对抗面

N/A：页面只接受固定枚举 scope 和本地搜索文本，不对外暴露 agent 指令入口。

## 真实调用方请求 shape

- Dashboard 生产调用方使用 `GET /api/brain/map?scope=<scope>`，无业务身份 body、无 tenant 字段，浏览器通过同源 `/api/brain` proxy 调用。
- scope 字面值只允许 `cecelia`、`zenithjoy-workspace`；DoD 与 E2E 必须使用相同 query 名 `scope`。

## 禁 mock 边清单

- Dashboard `fetch` ↔ Brain `GET /api/brain/map`：Final E2E 禁止 `page.route()`、`vi.mock` 或静态 fixture，必须请求真实 Brain。
- scope 选择状态 ↔ 异步响应提交：实现测试可控制响应先后，但不得替换页面的真实 scope 选择与响应归属逻辑。

## 未覆盖真实链路清单

- Vitest RED 使用受控 `fetch` 响应验证乱序和异常分支｜CI 需确定性制造竞态｜Final E2E 用真实 Brain 双 scope 补位；异常 freshness 由既有组件测试覆盖，生产接口当前为 fresh 时不得篡改响应。

## 接缝清单

- Dashboard ↔ Brain live map：在 `mac_web` 启动真实 Dashboard，保持 Brain 5221 在线，连续两次跑 Final E2E；结果不一致判 FLAKY。
- 浏览器导航 ↔ dynamic feature manifest：从 `/system` 可见入口进入 `/map`，截图与 URL 留证。

## Golden Path

覆盖父路 `butler/g1_command_deck` 第 keep-green 步。

[system-hub 入口] → [取当前 scope live map] → [切换 scope] → [展开/搜索三层节点] → [查看证明与关系] → [辨识 freshness/错误/空状态]

### Step 1: 从 system-hub 进入系统总图并看到 live 元数据
**来源**: `[FROM_PRD]` — Golden Path 第 1 步与 DoD 1。

**可观测行为**: `/system` 的主导航入口可进入 `/map`；加载后显示 manifest 版本、freshness、value stream/capability 统计。

**验证命令**: Final E2E 断言入口、URL、标题和统计与 `GET /api/brain/map?scope=cecelia` 同次响应相等。

**硬阈值**: 10 秒内进入成功态；API 非 2xx 时不得出现成功统计。

### Step 2: 双 scope 切换不串数据
**来源**: `[FROM_PRD]` — Golden Path 第 2 步与边界“较早请求不得覆盖较新 scope”。

**可观测行为**: 切到 `zenithjoy-workspace` 后标题、统计、节点仅来自该 scope，加载态在请求期间可见。

**验证命令**: Final E2E 读取两个真实 API 响应，逐次选择 scope 并核对页面统计；Vitest 固化乱序响应不覆盖当前 scope。

**硬阈值**: 每次切换 10 秒内稳定；当前 scope 必须等于响应 `scope_key`。

### Step 3: 展开、折叠和搜索价值流/能力/特性
**来源**: `[FROM_PRD]` — Golden Path 第 3 步与边界空状态。

**可观测行为**: 可按价值流 → 能力 → 特性探索；搜索命中定位节点，无匹配显示可理解空状态；特性展示证明数量与覆盖条。

**验证命令**: Playwright 点击首个价值流与能力、搜索 live 响应中节点名称并断言可见，再搜索唯一不存在串并断言空状态。

**硬阈值**: 每次交互 3 秒内出现可见结果，证明计数等于相连 `proves` 关系计算值。

### Step 4: 查看横切件和交接关系
**来源**: `[FROM_PRD]` — Golden Path 第 4 步。

**可观测行为**: 关系面板明确展示 live edges 中存在的 `serves`、`owned_by`、`hands_off_to`；某 scope 无该类边时显示空状态。

**验证命令**: Playwright 从真实 API 选取每种存在的关系，断言关系类型或端点名称在面板可见。

**硬阈值**: 不得把缺失关系伪装成存在；关系端点与同次 API edge 一致。

### Step 5: 非 fresh、失败和空数据 fail closed
**来源**: `[FROM_PRD]` — Golden Path 第 5 步和全部异常边界。

**可观测行为**: 非 fresh 警告持续可见；请求失败/非法或空投影显示错误/空状态与重试入口，不显示成功投影。

**验证命令**: Vitest 以真实组件请求边界控制异常结果，断言警告/错误/空态/重试；Final E2E 对当前 live freshness 断言 fresh 徽标或非 fresh 警告二者之一且与 API 一致。

**硬阈值**: 10 秒内出现确定状态；状态不得同时显示成功投影与错误。

### Step 6: 防造假与证据留存
**来源**: `[AI_ADDED]` — 防止用静态演示数据或旧 scope 响应让 UI 假绿。

**可观测行为**: evaluator 保存 live API 摘要、浏览器截图及 scope 切换后的页面文本；两次接缝执行结果一致。

**验证命令**: E2E 比较页面统计与运行时 API 对象，不写死 2/11；截图写入 sprint screenshots 目录。

**硬阈值**: 两次运行均通过；任一运行数据不一致即 FLAKY/FAIL。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/08232142-kernel-2f9de07c"
BASE_URL="http://127.0.0.1:5174"
mkdir -p "$SPRINT_DIR/screenshots"
curl -sf http://127.0.0.1:5221/api/brain/health | jq -e '.status == "healthy"'
npm --prefix apps/dashboard run dev -- --host 127.0.0.1 --port 5174 >/tmp/map-dashboard.log 2>&1 &
DASH_PID=$!
trap 'kill "$DASH_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -sf "$BASE_URL" >/dev/null && break; [ "$i" = 60 ] && { tail -50 /tmp/map-dashboard.log; exit 1; }; sleep 1; done
(cd apps/dashboard && E2E_BASE_URL="$BASE_URL" SPRINT_SCREENSHOTS="../../$SPRINT_DIR/screenshots" node --input-type=module <<'NODE'
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage();
const base = process.env.E2E_BASE_URL;
const api = async (scope) => await (await page.request.get(`${base}/api/brain/map?scope=${scope}`)).json();
const verifyScope = async (scope, shot) => {
  const truth = await api(scope);
  await page.getByLabel('Scope').selectOption(scope);
  const load = page.getByRole('button', { name: '加载' });
  if (await load.count()) await load.click();
  await expect(page.getByText(`Manifest v${truth.manifest_version}`)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(`${truth.summary.capabilities} 个 Capability`)).toBeVisible();
  await expect(page.getByText(`${truth.summary.value_streams} 条价值流`)).toBeVisible();
  const statusText = truth.freshness.status === 'fresh' ? '新鲜' : truth.freshness.status;
  await expect(page.getByText(statusText, { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: `${process.env.SPRINT_SCREENSHOTS}/${shot}`, fullPage: true });
  return truth;
};
await page.goto(`${base}/system`);
await expect(page.getByRole('link', { name: /地图/ })).toBeVisible({ timeout: 10000 });
await page.getByRole('link', { name: /地图/ }).click();
await expect(page).toHaveURL(/\/map$/);
await expect(page.getByRole('heading', { name: '通用地图' })).toBeVisible();
const cecelia = await verifyScope('cecelia', 'staging-cecelia.png');
await verifyScope('zenithjoy-workspace', 'staging-zenithjoy.png');
const searchable = cecelia.nodes.find((node) => ['value_stream','capability','feature'].includes(node.type) && node.name);
if (!searchable) throw new Error('live map 无可搜索节点');
const search = page.getByRole('searchbox');
await search.fill(searchable.name);
await expect(page.getByText(searchable.name, { exact: false }).first()).toBeVisible();
await search.fill(`missing-${Date.now()}`);
await expect(page.getByText(/无匹配|没有匹配/)).toBeVisible();
await browser.close();
NODE
)
test -s "$SPRINT_DIR/screenshots/staging-cecelia.png"
test -s "$SPRINT_DIR/screenshots/staging-zenithjoy.png"
```

## staging 预览闸

- 步骤 A：引用 Cecelia 现有 staging 部署流程落到 `localhost:5212`，合同不重造部署脚本。
- 步骤 B：在 staging 重跑上述 Final E2E，截图保存为 `${SPRINT_DIR}/screenshots/staging-<step>.png`。
- 步骤 C：向 `$BARK_URL` 发送 staging 链接和截图链接，注明“24h 无异议自动放行”；PATCH Brain task metadata 写入 `staging_deployed:true`、`staging_url` 与 UTC+24h 的 `promote_after`。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 地址栏把 `scope` 改为不支持值，确认不会展示成功投影。
- 重复提交: 快速连续切换两个 scope 并重复点击加载。
- 中途中断: scope 加载期间切换 scope、返回 `/system` 再进入。
- 边界值: 搜索空串、超长串、不存在串；展开无关系或无证明节点。
- 发现分级: P0/P1（错误系统状态直接面客或旧 scope 覆盖新 scope）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 系统总图冻结测试 | `sprints/08232142-kernel-2f9de07c/tests/map-page.contract.test.ts` | `系统总图页面文件存在并包含 live map 用户路径`、`planning manifest 提供唯一地图入口` | MapPage 尚不存在，至少 1 failure |
| 既有 Dashboard 补充测试 | `apps/dashboard/src/pages/map/MapPage.test.tsx` | `只从动态 feature manifest 注册唯一 /map 页面`、`从 Capability 下钻到 Feature/Assertion` | MapPage import 失败 |
