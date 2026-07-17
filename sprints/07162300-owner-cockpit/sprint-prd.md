# Sprint PRD — 主理人指挥舱（Owner Cockpit）

**Task ID**: 80a5be84-059a-4d86-a55c-a1e38f84e043
**Sprint Dir**: sprints/07162300-owner-cockpit
**日期**: 2026-07-16
**优先级**: P0

---

## Invariant 约束段

> 从 Brain DB decisions / 代码铁律加载，本 sprint 必须遵守

1. **禁止 generator 自 merge PR**（decision e8230eb5）：harness-generator 只推 branch + 报告 branch ready，merge 权归 controller，本 sprint 不得在 CI 脚本或 E2E 代码中添加 auto-merge 逻辑。
2. **现有页面全部保留**：/ 设为新聚合首页，warroom/tasks/harness-pipeline/live-monitor 等 16 个现有路由作为二级入口，不得删除或重命名任何已有页面路由。
3. **数据必须来自既有 API，不得造假**：六指标卡不允许硬编码 mock 数据；E2E 断言必须验证真实 API 响应值，禁止使用 `data-testid="fake-*"` 或占位符数字。
4. **禁止手动 build 部署**：HK 公网实例更新必须走既有 dashboard-deploy webhook 双实例路径（`packages/brain/src/routes/deploy-dev.js`），禁止 SSH 手动构建。
5. **Bark 通知必须复用 BARK_TOKEN**（`packages/brain/src/notifier.js:sendBark`）：不得引入新的推送 SDK 或硬编码 token，晨报定时任务挂在既有 `scheduler-jobs.js` JOBS 数组中。
6. **主分支禁直推**：所有代码变更通过 `cp-*/feature/*` 分支 → PR → main，CI 必须绿才能 merge。
7. **E2E 环境路由死规则**：Dashboard Playwright 测试走 `mac_web`（localhost:5174，本机），不走 windows_cloud runner。

---

## 累积 FR 段

### FR-01 默认路由替换
将 `apps/dashboard` 的默认路由 `/` 从当前占位或重定向替换为新的 `OwnerCockpitPage` 组件；导航配置 `navigation.config.ts` 中首页 featureKey 设为始终启用。

### FR-02 六指标 Header
顶部 Header 展示 6 个关键指标卡，数据来源：

| 指标 | 数据源 API |
|------|-----------|
| 零人工完成率 | `GET /api/brain/harness/stats` → `completion_rate` |
| 金丝雀连续绿天数 | `GET /api/brain/guard-drill/status` → `last_drill_fired=false` 连续天数 |
| 闸开火计数（近30天） | `GET /api/brain/harness/stats` → `total_pipelines` |
| merge→生产时延 | `GET /api/brain/dev-records` → PR merge 到 deploy record 时间差均值 |
| 队列健康（queued 任务数） | `GET /api/brain/tasks?status=queued` → count |
| 踩雷数（近30天 blocked 任务） | `GET /api/brain/tasks?status=blocked` → count |

若某 API 当前缺少只读聚合端点（judge 日志统计），本 sprint 在 `packages/brain/src/routes/` 中补充只读 GET 端点，不得新增写操作。

### FR-03 作战板
展示 `status IN (in_progress, queued, blocked)` 的任务，按 title 前缀（取首个中文/英文词组，`：` 或空格前缀聚类）分组为战役卡片；点击任务跳转 `/harness-pipeline?task_id=:id` 详情页。

### FR-04 晨报 Feed
调用 `GET /api/brain/design-docs?type=diary&limit=7` 获取最近 7 天日报列表；每条可展开查看正文（`content` 字段 Markdown 渲染）；默认折叠，点击标题展开。

### FR-05 演习状态条
调用 `GET /api/brain/guard-drill/status` 展示：最近一次演习结果（`last_drill_fired`）+ 最近演习时间 + 连续绿计数（前端计算：连续 `last_drill_fired=false` 的 guard 数量）。

### FR-06 导览区
展示 16 个既有页面的一句话说明与链接，静态配置即可；移动端 2 列 grid，桌面端 4 列 grid。

现有页面清单（`apps/dashboard/src/pages/`）：
account-usage、area-slots、brain-models、clips、collection-dashboard、harness-pipeline、live-monitor、relay-progress、reports、roadmap、settings、task-type-configs、tasks、test-pyramid、viral-analysis、warroom（共 16 个）。

### FR-07 Mobile-First 布局
页面使用 Tailwind `sm:` / `md:` / `lg:` 响应式断点；指标卡在移动端单列堆叠，桌面端 3 列；作战板和晨报 feed 移动端全宽。全页面无水平滚动条（`overflow-x: hidden`）。

### FR-08 HK 公网实例部署验证
检查既有 dashboard-deploy webhook 链路是否通畅（`packages/brain/src/routes/deploy-dev.js`）；PR 描述中写明 HK 公网访问 URL；若链路断则修通，禁止手动 build。

### FR-09 每晨 08:30 Bark 推送
在 `packages/brain/src/scheduler-jobs.js` 的 JOBS 数组中新增 `morning-cockpit-bark` job：
- 北京时间 08:30（UTC 00:30）窗口触发
- 调用 `getBriefing()` 获取摘要 + `GET /api/brain/guard-drill/status` 取演习状态
- 用 `sendBark()` 推送：「☀️ 晨报 | 六指标速览 + HK 指挥舱链接」
- 当日去重（sentinel key: `morning-cockpit-bark`）

### FR-10 E2E Playwright 验收
新增 `apps/dashboard/src/test/owner-cockpit.e2e.ts`（或 `packages/quality/`）：
- 打开 `http://localhost:5174/`
- 断言六指标卡均可见（`data-testid="metric-card-*"`），且数值为非空非零字符串（真实 API 数据）
- 断言作战板至少有 1 张任务卡片渲染（`data-testid="battle-card"`）
- 截图保存为 `owner-cockpit.png` 作为证据

---

## NFR 段

- **性能**：首屏 LCP < 3s（localhost），页面初始加载 API 并行 fetch，不串行等待。
- **可维护性**：新增页面后仅需修改导览区静态配置，不改组件逻辑。
- **错误处理**：任意 API 失败时对应指标卡显示 `--`，不崩溃整页。
- **安全**：BARK_TOKEN 不得出现在前端代码，仅在 Brain 服务端调用。

---

journey_type: ui-feature
target_environment: mac_web
