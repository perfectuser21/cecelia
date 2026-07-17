# 合同草案 — 主理人指挥舱（Owner Cockpit）

**Task ID**: 80a5be84-059a-4d86-a55c-a1e38f84e043
**Sprint Dir**: sprints/07162300-owner-cockpit
**合同版本**: v2（第 2 轮，修复 Reviewer R1 REVISION 反馈）
**日期**: 2026-07-16

---

## 功能范围

### FR-01 默认路由替换
- `apps/dashboard/src/pages/` 新增 `owner-cockpit/OwnerCockpitPage.tsx` 组件
- `apps/api`（或 `coreConfig.navGroups`）中，将路径 `/` 的 `featureKey` 设为始终启用（无条件显示）
- 确保访问 `http://localhost:5174/` 直接渲染 `OwnerCockpitPage`，而非重定向到其他页面或显示占位内容
- **不得删除或重命名**现有 16 个路由（warroom/tasks/harness-pipeline 等）

### FR-02 六指标 Header
- 顶部 Header 渲染 6 张指标卡，每张含 `data-testid="metric-card-{slug}"`，slug 分别为：
  `completion-rate`、`canary-green-days`、`gate-fires`、`merge-to-deploy`、`queue-health`、`blocked-count`
- 数据来源严格对应：

  | 指标卡 slug | API | 响应字段 |
  |---|---|---|
  | `completion-rate` | `GET /api/brain/harness/stats` | `completion_rate` |
  | `canary-green-days` | `GET /api/brain/guard-drill/status` | 前端计算：`guards` 数组中连续 `last_drill_fired=false` 的数量 |
  | `gate-fires` | `GET /api/brain/harness/stats` | `total_pipelines` |
  | `merge-to-deploy` | `GET /api/brain/dev-records` | 前端计算：PR merge 到 deploy record 时间差均值（ms → 分钟） |
  | `queue-health` | `GET /api/brain/tasks?status=queued` | 响应数组长度（count） |
  | `blocked-count` | `GET /api/brain/tasks?status=blocked` | 响应数组长度（count） |

- 任意 API 失败时，对应卡片展示 `--`，不崩溃整页
- 禁止硬编码 mock 数值；禁止使用 `data-testid="fake-*"` 占位符
- **边界规则**：
  - `guards` 数组为空时，`canary-green-days` 显示 `0`
  - `merge-to-deploy` 时差为负值（数据异常）或无 dev_records 时，显示 `--`

### FR-03 作战板
- 调用 `GET /api/brain/tasks?status=in_progress`、`?status=queued`、`?status=blocked` 获取任务列表
- 按 task `title` 前缀（`：` 或空格前首词聚类）分组为战役卡片，每张卡片含 `data-testid="battle-card"`
- 点击任务条目跳转 `/harness-pipeline?task_id={id}`
- 作战板至少渲染 1 张战役卡片（以真实 DB 数据为准，测试前 Brain 需有活跃任务）

### FR-04 晨报 Feed
- 调用 `GET /api/brain/design-docs?type=diary&limit=7`
- 渲染最近 7 条日报列表，每条默认折叠
- 点击标题展开，正文以 Markdown 渲染（支持 `content` 字段）
- 每条含唯一 `data-testid="diary-item-{index}"`

### FR-05 演习状态条
- 调用 `GET /api/brain/guard-drill/status`
- 展示最近一次演习结果（`last_drill_fired` bool）、最近演习时间（`last_run_at`）、连续绿计数
- 连续绿计数 = `guards` 数组中从末尾起连续 `last_drill_fired === false` 的数量（前端逻辑）

### FR-06 导览区
- 静态配置 16 个既有页面（account-usage、area-slots、brain-models、clips、collection-dashboard、harness-pipeline、live-monitor、relay-progress、reports、roadmap、settings、task-type-configs、tasks、test-pyramid、viral-analysis、warroom）的一句话说明与链接
- 移动端 2 列 grid，桌面端 4 列 grid（Tailwind `grid-cols-2 md:grid-cols-4`）
- 新增页面只改静态配置，不改组件逻辑

### FR-07 Mobile-First 布局
- 使用 Tailwind `sm:` / `md:` / `lg:` 响应式断点
- 指标卡移动端单列堆叠（`grid-cols-1`），桌面端 3 列（`md:grid-cols-3`）
- 作战板、晨报 Feed 移动端全宽
- 全页面无水平滚动条（根元素 `overflow-x-hidden`）

### FR-08 HK 公网实例部署验证
- 核查 `packages/brain/src/routes/deploy-dev.js` webhook 链路是否通畅
- 若链路断则修通；禁止 SSH 手动 build
- PR 描述中写明 HK 公网访问 URL

### FR-09 每晨 08:30 Bark 推送
- 在 `packages/brain/src/scheduler-jobs.js` 的 `JOBS` 数组末尾新增：
  ```js
  { name: 'morning-cockpit-bark', needsPool: true, timeoutMs: 30 * 1000, handler: maybeSendMorningCockpitBark, description: '主理人指挥舱晨报 Bark（北京08:30，当日去重，sentinel key: morning-cockpit-bark）' }
  ```
- handler `maybeSendMorningCockpitBark` 在 `packages/brain/src/morning-cockpit-bark.js` 中实现：
  - UTC 00:30 ± 5min 窗口触发（北京 08:30）
  - sentinel key `morning-cockpit-bark` 当日去重
  - 调用既有 `sendBark()` 推送「☀️ 晨报 | 六指标速览 + HK 指挥舱链接」
  - BARK_TOKEN 仅在 Brain 服务端使用，不得传到前端

### FR-10 E2E Playwright 验收
- 新增 `sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts`
- 打开 `http://localhost:5174/`
- 断言 6 张指标卡均可见（`data-testid="metric-card-*"`），且 innerText 为非空、非 `--` 字符串（真实 API 数据）
- 断言作战板至少 1 张任务卡片（`data-testid="battle-card"`）可见
- 截图保存为 `owner-cockpit.png`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| FR-01 | `../../tests/regression/owner-cockpit/owner-cockpit.e2e.ts` | FR-01: 根路由渲染 OwnerCockpitPage | 缺 OwnerCockpitPage 组件时 test 超时红 |
| FR-02 | `../../tests/regression/owner-cockpit/owner-cockpit.e2e.ts` | FR-02: 六张指标卡均可见/FR-02: 六张指标卡数值均非空 | 缺 metric-card-* 元素或 innerText 为空时红 |
| FR-03 | `../../tests/regression/owner-cockpit/owner-cockpit.e2e.ts` | FR-03: 作战板至少 1 张战役卡片可见/FR-03: 点击任务条目跳转 | 缺 battle-card 元素时红 |
| FR-07 | `../../tests/regression/owner-cockpit/owner-cockpit.e2e.ts` | FR-07: 移动端（375px）无水平滚动条 | scrollWidth > 375 时断言失败 |
| FR-09 | `../../tests/regression/owner-cockpit/owner-cockpit.e2e.ts` | FR-09: morning-cockpit-bark job 已在 JOBS 数组中注册/FR-09: morning-cockpit-bark handler 无硬编码 BARK_TOKEN | JOBS 无条目或含硬编码 token 时红 |
| FR-10 | `../../tests/regression/owner-cockpit/owner-cockpit.e2e.ts` | FR-10: 截图存证（owner-cockpit.png） | 截图文件不存在时红 |

---

## E2E 验收

### Playwright 脚本路径
```
sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts
```

### 执行命令
```bash
# 前置：确保 Brain（5221）和 Dashboard（5174）均已运行
curl -sf http://localhost:5221/api/brain/tasks?status=in_progress > /dev/null || echo "Brain not running"
curl -sf http://localhost:5174 > /dev/null || echo "Dashboard not running"

# 运行 E2E
npx playwright test sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts --reporter=line
```

### 产物验证
```bash
# 截图存在且大小 > 10KB
test -f owner-cockpit.png && wc -c owner-cockpit.png | awk '{if($1>10240) print "PASS: screenshot ok"; else print "FAIL: screenshot too small"}'
```

---

## 未覆盖真实链路清单

| # | 链路 | mock 豁免原因 |
|---|---|---|
| 1 | Bark 推送（`sendBark()`）| E2E 测试环境不注入真实 BARK_TOKEN；scheduler 定时行为以 sentinel key 写入 working_memory 替代验证 |
| 2 | HK 公网 deploy webhook 实际触发 | deploy-dev.js 链路测试为集成测试，不在 Playwright E2E 范围内；PR 描述写明 HK URL 作为人工验证凭据 |
| 3 | `merge-to-deploy` 时延均值（`GET /api/brain/dev-records`）| 若 dev_records 表为空则前端显示 `--`，E2E 断言允许 `--` 或合理数值 |

---

## 判定点登记表

| ID | 断言 | 来源 API / 文件 | 失败表现 | 可接受阈值 |
|---|---|---|---|---|
| J-01 | 6 张 `metric-card-*` 在 DOM 中全部可见 | 前端 `OwnerCockpitPage.tsx` | Playwright 找不到元素，超时报错 | 6/6 均 visible |
| J-02 | 指标卡数值为非空字符串（或 `--`），不含 `undefined` / `null` | `GET /api/brain/harness/stats` 等 | innerText 为空或字面量 "undefined" | 6/6 卡片 innerText ≠ "" |
| J-03 | 作战板至少 1 张 `battle-card` 可见 | `GET /api/brain/tasks?status=in_progress` | 无 battle-card 元素 | ≥ 1 个 battle-card |
| J-04 | Bark job 在 JOBS 数组中注册且名称为 `morning-cockpit-bark` | `packages/brain/src/scheduler-jobs.js` | grep 找不到 job name | 代码静态检查通过 |
| J-05 | scheduler job handler 调用 sendBark，不含硬编码 token | `packages/brain/src/morning-cockpit-bark.js` | grep 到字面量 token 字符串 | 代码静态检查通过 |
| J-06 | 页面无水平滚动条（viewport 宽度 375px） | `OwnerCockpitPage.tsx` 根元素 overflow-x-hidden | `document.body.scrollWidth > 375` | scrollWidth ≤ viewport |
| J-07 | 截图文件 `owner-cockpit.png` 存在且 > 10KB | Playwright `screenshot()` | 文件不存在或为空截图 | 文件大小 > 10240 bytes |
