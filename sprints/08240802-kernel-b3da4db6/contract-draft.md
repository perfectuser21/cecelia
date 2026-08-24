# Sprint Contract Draft (Round 3)

## Notes

- 实现基线固定为 `6cc74f728b9c515cf67130a9b06b20e03d651772`；本角色 checkout SHA 不替换该基线。
- `[MAP_NOT_CONFIGURED]`：task payload 的 `map_scope` 为数组且无 `map_repo`，无法调用 radius 映射；不回退到领域硬编码，`must_run_assertions` 为空。
- Registry 三类查询均为空，按 PRD 与现有 map API/页面测试字面约定起草 `[NEW_PATTERN]`。
- context-manifest: unavailable（端点返回 404）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD 字面 + 现有 GET /api/brain/map 实际响应）

### Endpoint: GET /api/brain/map?scope=cecelia|zenithjoy-workspace

**Success (HTTP 200)**：页面消费 `scope_key`、`manifest_version`、`projection_digest`、`fact_revisions`、`freshness.status`、`nodes[]`、`edges[]`、`summary` 与 `shared_prerequisites`。其中节点字面字段为 `key/type/name/state/state_reason/attributes`，边字面字段为 `from/to/type/attributes`。

**Error**：HTTP 非 2xx、空 `nodes` 或 scope 无匹配节点均进入页面可见错误/空态，不沿用旧 scope 数据。

**禁用字段名**：`scope` 代替 `scope_key`、`version` 代替 `manifest_version`、静态内置节点数组。

## 已知约束（来自回归测试）

- `apps/dashboard/src/pages/map/MapPage.test.tsx` → 唯一 `/map` 动态路由；投影元数据、横切件、下钻证据、双 scope revision 回退。
- `apps/dashboard/src/pages/map/MapPage.auth.test.tsx` → 公共 Dashboard 不暴露 map rebuild。
- `[累积FR]` context-manifest: unavailable；PRD 明示本 line 暂无历史行为。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 从 system-hub 进入系统总图，实时展示双 scope 的三层地图、证明、覆盖、横切、交接、搜索与折叠。 |
| NFR（做得多好） | 最后一次 scope 选择权威；非 fresh 持续可见；浏览器请求 10 秒内给出结果或明确失败。 |
| Invariant（永不违反） | map API 是唯一数据真相；旧请求不得覆盖新选择；不暴露 rebuild；不记录 secret/PII。 |
| 判定点（怎么知道） | 以响应 `freshness.status`、节点/边关系及浏览器可见 DOM 为准。 |
| 保质期（何时过期） | 每次进入、切换 scope 均重新 fetch；页面不缓存为权威。 |
| 死亡告警（停了谁知道） | 请求失败即在 10 秒内向当前用户显示错误态。 |
| 失败语义（挂了怎么办） | fail closed：清空旧图并显示错误/空态，不误报 fresh。 |
| 效果确认（已发≠已生效） | UI 数量与同轮 API 响应逐项比对，并留截图。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| freshness 是否新鲜 | 页面推测时间；API 字段 | API `freshness.status` 字面值 | PRD 指定 API 为唯一真相 | stale 被误报为 fresh |
| 最终 scope 是否正确 | 请求发起顺序；选择框与最终响应 | 选择框值 + 最后请求响应的 `scope_key` | 快速切换边界要求 | 展示旧 scope 数据 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| map API 非 2xx/超时 | 清空旧图、显示加载失败 | 是，GET 可重试 | 用户可重试，不展示旧数据 |
| 空 nodes/搜索无匹配 | 显示明确空态 | 是 | 保留 scope 与搜索输入 |
| freshness 非 fresh | 图可读但持续警示 | N/A | 禁止显示“新鲜”成功态 |

### 输入对抗面

N/A：页面仅消费受信 Brain 同源 API；搜索文本只做客户端过滤，不执行指令或 HTML。

## 真实调用方请求 shape

- Dashboard 生产调用形态：同源 `GET /api/brain/map?scope=<scope>`，无 body；scope 字面仅允许 `cecelia`、`zenithjoy-workspace`。
- 页面不得调用 rebuild；现有同源代理负责端点鉴权边界，本 sprint 不修改 API/auth。

## 禁 mock 边清单

- MapPage ↔ 浏览器 `fetch` ↔ Brain map API（Final E2E 必须真请求，不得 `page.route()` 或替换响应；HTTP 失败用浏览器真实离线网络制造）。
- scope 选择状态 ↔ 异步响应提交（快速切换必须让最后一次选择成为最终视图）。

## 未覆盖真实链路清单

（本合同 Final E2E 无 mock 豁免，N/A；冻结 RED 测试只验证尚未实现的纯页面投影逻辑。）

## Golden Path

覆盖父路 `butler/g1_command_deck` keep-green 步骤。

[system-hub 入口] → [实时取图] → [三层浏览与定位] → [异常状态不误报]

### Step 1: 从 system-hub 打开系统总图并取得实时投影
**来源**: `[FROM_PRD]` — “Golden Path”第 1 步与“范围限定”。

**可观测行为**: `/map` 页面显示“通用地图”、所选 scope、Manifest 版本、投影摘要及 freshness 徽标。

**验证命令**: `curl -sf 'localhost:5221/api/brain/map?scope=cecelia' | jq -e '.scope_key=="cecelia" and (.manifest_version|type=="number") and (.freshness.status|type=="string") and (.nodes|type=="array") and (.edges|type=="array")'`

**硬阈值**: HTTP 200；10 秒内页面出现与 API 字面值一致的元数据。

### Step 2: 浏览价值流、能力、特性与证明
**来源**: `[FROM_PRD]` — “Golden Path”第 2 步。

**可观测行为**: 三层结构可折叠，Feature 显示证明数/覆盖条；横切件与 `hands_off_to` 交接独立可见。

**验证命令**: `bash -c 'awk '\''/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'\'' sprints/08240802-kernel-b3da4db6/contract-draft.md >/tmp/map-contract-e2e.sh && bash /tmp/map-contract-e2e.sh'`

**硬阈值**: cecelia 当前 API 的价值流/能力数量与 UI 相等；每个可见证明与边均来自响应。

### Step 3: 切换 scope、搜索并处理并发选择
**来源**: `[FROM_PRD]` — “Golden Path”第 3 步与边界情况。

**可观测行为**: 双 scope 可切换；搜索只保留匹配节点和祖先层级；无结果有空态；快速切换最终显示最后选择。

**验证命令**: `bash -c 'awk '\''/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'\'' sprints/08240802-kernel-b3da4db6/contract-draft.md >/tmp/map-contract-e2e.sh && bash /tmp/map-contract-e2e.sh'`

**硬阈值**: 最终 `scope_key` 等于选择框值；旧 scope 名称与节点不残留。

### Step 4: 非 fresh、失败与空投影 fail closed
**来源**: `[FROM_PRD]` — “Golden Path”第 4 步与边界情况。

**可观测行为**: stale/unknown 持续提示；HTTP 错误或空 nodes 显示明确状态且清除旧图。

**验证命令**: `bash -c 'awk '\''/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'\'' sprints/08240802-kernel-b3da4db6/contract-draft.md >/tmp/map-contract-e2e.sh && bash /tmp/map-contract-e2e.sh'`

**硬阈值**: 页面不可同时显示错误/非 fresh 与“新鲜”；失败后旧节点计数为 0。

### Step 5: 防止静态快照或 mock 冒充实时数据
**来源**: `[AI_ADDED]` — 防止实现用设计稿静态节点绕过 live fetch 要求。

**可观测行为**: Final E2E 先取真实 API，再在浏览器中逐项核对 manifest、freshness 与节点计数。

**验证命令**: `bash -n /tmp/e2e-selfcheck.sh`

**硬阈值**: 浏览器断言值全部来自本轮真实 API 响应；禁止 `page.route()`。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner must inject current execution identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
SPRINT_DIR="sprints/08240802-kernel-b3da4db6"
mkdir -p "$SPRINT_DIR/screenshots"
API_JSON=$(mktemp)
trap 'rm -f "$API_JSON" /tmp/map-final-e2e.mjs' EXIT
curl -sf 'http://localhost:5221/api/brain/map?scope=cecelia' | jq -c . > "$API_JSON"
curl -sf 'http://localhost:5221/api/brain/map?scope=zenithjoy-workspace' | jq -c . >> "$API_JSON"
jq -s -e 'length==2 and .[0].scope_key=="cecelia" and (.[0].nodes|length>0) and (.[0].edges|length>0)' "$API_JSON" >/dev/null
cat > /tmp/map-final-e2e.mjs <<'JS'
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const apis = fs.readFileSync(process.env.API_JSON, 'utf8').trim().split('\n').map(JSON.parse);
const api = apis.find(x => x.scope_key === 'cecelia');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5174/system-hub');
await page.getByRole('link', { name: /系统总图|地图/ }).click();
await page.getByRole('heading', { name: '通用地图' }).waitFor({ timeout: 10000 });
await page.screenshot({ path: `${process.env.SPRINT_DIR}/screenshots/staging-map-initial.png`, fullPage: true });
const body = page.locator('body');
const text = async () => await body.textContent() || '';
if (!(await text()).includes(`Manifest v${api.manifest_version}`)) throw new Error('manifest 不一致');
if (!(await text()).includes(api.freshness.status === 'fresh' ? '新鲜' : api.freshness.status)) throw new Error('freshness 不一致');
const capabilityCount = api.nodes.filter(n => n.type === 'capability').length;
await page.getByText(`${capabilityCount} 个 Capability`).waitFor();
const visibleText = async () => await body.textContent() || '';
for (const [label, expected] of [['Capability', api.summary.capabilities], ['边界', api.summary.boundaries], ['横切件', api.summary.crosscuts]]) {
  if (!(await visibleText()).includes(`${expected} ${label === 'Capability' ? '个' : label === '边界' ? '条' : '项'}${label}`)) throw new Error(`${label} summary 不一致`);
}

// 三层、折叠、证明/覆盖、横切件与交接必须由真实 DOM 证明。
const capability = api.nodes.find(n => n.type === 'capability' && api.edges.some(e => e.from === n.key && e.type === 'contains'));
if (!capability) throw new Error('API 无可下钻 Capability');
const featureEdge = api.edges.find(e => e.from === capability.key && e.type === 'contains');
const feature = api.nodes.find(n => n.key === featureEdge?.to);
await page.getByRole('button', { name: new RegExp(capability.name) }).click();
await page.getByRole('heading', { name: new RegExp('Level 2') }).waitFor();
if (feature && !(await text()).includes(feature.name)) throw new Error('Feature 层未展示');
await page.getByText(/证明|Assertion/).first().waitFor();
await page.getByText(/覆盖|Coverage/).first().waitFor();
await page.getByRole('heading', { name: '横切件' }).waitFor();
const proofEdges = api.edges.filter(e => e.from === feature?.key && e.type === 'proves');
for (const edge of proofEdges) {
  const assertion = api.nodes.find(n => n.key === edge.to);
  if (assertion && !(await text()).includes(assertion.name)) throw new Error(`证明未展示: ${assertion.name}`);
  for (const anchored of api.edges.filter(e => e.from === edge.to && e.type === 'anchored_by')) {
    const artifact = api.nodes.find(n => n.key === anchored.to);
    const coverage = artifact?.attributes?.stable_ref || artifact?.name;
    if (coverage && !(await text()).includes(coverage)) throw new Error(`覆盖条未展示: ${coverage}`);
  }
}
for (const crosscut of api.nodes.filter(n => n.type === 'crosscut')) {
  if (!(await text()).includes(crosscut.name)) throw new Error(`横切件未展示: ${crosscut.name}`);
}
for (const edge of api.edges.filter(e => e.type === 'hands_off_to')) {
  const label = edge.attributes?.statement;
  if (label && !(await text()).includes(label)) throw new Error(`交接未展示: ${label}`);
}
const firstAssertion = api.nodes.find(n => proofEdges.some(e => e.to === n.key));
if (firstAssertion) {
  const receiptResponse = page.waitForResponse(r => r.url().includes(`/nodes/${encodeURIComponent(firstAssertion.key)}`) && r.ok());
  await page.getByRole('button', { name: new RegExp(firstAssertion.name) }).click();
  const receiptApi = await (await receiptResponse).json();
  const receipt = receiptApi.node?.state_details?.receipt;
  if (!receipt) throw new Error('真实 node API 缺 receipt');
  for (const value of [receipt.verdict, receipt.source_sha, receipt.completed_at]) {
    if (value && !(await text()).includes(String(value))) throw new Error(`receipt 字段未展示: ${value}`);
  }
}
const collapse = page.getByRole('button', { name: new RegExp(`折叠.*${capability.name}|${capability.name}.*折叠`) });
await collapse.click();
if (feature && await page.getByText(feature.name, { exact: true }).isVisible()) throw new Error('折叠后 Feature 仍可见');
await page.getByRole('button', { name: new RegExp(capability.name) }).click();

// 搜索保留匹配节点与祖先层级；清空后验证无结果反馈。
await page.getByLabel('搜索').fill(capability.name);
await page.getByText(capability.name, { exact: true }).waitFor();
const parentEdge = api.edges.find(e => e.to === capability.key && e.type === 'contains');
const parent = api.nodes.find(n => n.key === parentEdge?.from);
if (parent && !(await text()).includes(parent.name)) throw new Error('搜索未保留祖先层级');
await page.getByLabel('搜索').fill(`no-match-${Date.now()}`);
await page.getByText(/没有匹配|无搜索结果/).waitFor();
await page.getByLabel('搜索').fill('');
await page.screenshot({ path: `${process.env.SPRINT_DIR}/screenshots/staging-map-search.png`, fullPage: true });

// 快速双切换：等待最后 scope 的响应与 DOM，旧 scope 必须消失。
await page.getByLabel('Scope').selectOption('zenithjoy-workspace');
await page.getByRole('button', { name: '加载' }).click();
await page.getByLabel('Scope').selectOption('cecelia');
await page.getByRole('button', { name: '加载' }).click();
await page.getByLabel('Scope').selectOption('zenithjoy-workspace');
const lastResponse = page.waitForResponse(r => r.url().includes('scope=zenithjoy-workspace') && r.ok());
await page.getByRole('button', { name: '加载' }).click();
const zenApi = await (await lastResponse).json();
await page.getByText(`Manifest v${zenApi.manifest_version}`).waitFor();
if (!(await text()).includes('zenithjoy-workspace')) throw new Error('最后 scope 未胜出');
if ((await text()).includes(`cecelia ${api.fact_revisions.cecelia?.slice(0, 12)}`)) throw new Error('旧 scope 残留');
await page.screenshot({ path: `${process.env.SPRINT_DIR}/screenshots/staging-map-scope.png`, fullPage: true });

// 真实浏览器 HTTP 失败：关闭浏览器网络，不拦截或伪造 API；失败后旧节点和成功徽标必须清零。
const oldNodeName = zenApi.nodes.find(n => n.type === 'capability')?.name;
await page.context().setOffline(true);
await page.getByRole('button', { name: '加载' }).click();
await page.getByText(/加载失败|请求失败|网络错误/).waitFor({ timeout: 10000 });
if (oldNodeName && await page.getByText(oldNodeName, { exact: true }).isVisible()) throw new Error('HTTP 失败后旧节点仍可见');
if (await page.getByText('新鲜', { exact: true }).isVisible()) throw new Error('HTTP 失败仍显示成功徽标');
await page.context().setOffline(false);
await page.screenshot({ path: `${process.env.SPRINT_DIR}/screenshots/staging-map-http-error.png`, fullPage: true });

// non-fresh/空 nodes 只能使用真实 map API 响应；当前两 scope 无对应样本时保留接缝 pending，不以替身假绿。
const nonFresh = apis.find(x => x.freshness?.status !== 'fresh');
const empty = apis.find(x => Array.isArray(x.nodes) && x.nodes.length === 0);
for (const [kind, sample] of [['non-fresh', nonFresh], ['empty', empty]]) {
  if (!sample) {
    console.log(`logic-done-pending: live map API 未提供 ${kind} 样本`);
    continue;
  }
  await page.getByLabel('Scope').selectOption(sample.scope_key);
  await page.getByRole('button', { name: '加载' }).click();
  if (kind === 'non-fresh') {
    await page.getByText(new RegExp(sample.freshness.status, 'i')).waitFor({ timeout: 10000 });
    if (await page.getByText('新鲜', { exact: true }).isVisible()) throw new Error('non-fresh 仍显示成功徽标');
  } else {
    await page.getByText(/无数据|空投影|没有节点/).waitFor({ timeout: 10000 });
    if (await page.locator('[data-map-node]').count() !== 0) throw new Error('空投影仍保留旧节点');
  }
}
await browser.close();
JS
API_JSON="$API_JSON" SPRINT_DIR="$SPRINT_DIR" node /tmp/map-final-e2e.mjs
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 地址栏传入不支持的 scope。
- 重复提交: 连续快速点击加载并交替切换两个 scope。
- 中途中断: 加载中刷新/返回 system-hub 再进入。
- 边界值: 空搜索、超长搜索、无匹配、freshness unknown。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## staging 预览闸

- 步骤 A：使用仓库现有 staging 流程落到 Cecelia `localhost:5212`，不新建部署脚本。
- 步骤 B：将上述 Final E2E 的 base URL 改为 `localhost:5212` 运行，截图保存至 `sprints/08240802-kernel-b3da4db6/screenshots/staging-<step>.png`。
- 步骤 C：以 `$BARK_URL` 发送 staging 链接与截图链接，注明“24h 无异议自动放行”；PATCH Brain task metadata 写入 `staging_deployed:true`、UTC+24h `promote_after`、`staging_url`。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 系统总图实时投影 | `sprints/08240802-kernel-b3da4db6/tests/map-page-contract.test.ts` | `map API 实时投影必须转换为三层可见模型`；`失败或空投影必须清除上一 scope`；`搜索必须保留匹配能力的祖先层级`；`非 fresh、HTTP 失败和空 nodes`；`双 scope 响应竞态必须只提交最后一次选择` | MapPage 投影模块与竞态控制器尚不存在，import/断言失败 |
| 页面完整交互（补充） | `apps/dashboard/src/pages/map/MapPage.test.tsx` | `Level 1 展示冻结清单`；`从 Capability 下钻`；`第二个 scope` | MapPage 尚不存在，suite FAIL |
