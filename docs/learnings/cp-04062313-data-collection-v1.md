# Learning: 数据采集v1 - 多平台集成与采集仪表盘

**分支**: cp-04060806-d33d49cd-3ac5-471d-8e2e-875f77
**日期**: 2026-04-06

## 根本原因

Brain 已有完整的数据采集基础设施（`social-media-sync.js`、`daily-scrape-scheduler.js`、`content_analytics` 表），但缺少统一的健康率 API 和可视化仪表盘，导致无法感知各平台数据流入状态。

## 做了什么

1. 新增 `GET /api/brain/analytics/collection-stats` 端点（`routes/analytics.js`）：
   - 查询 `content_analytics` 近 7 天每平台每日数据量
   - 查询 `tasks` 表中 `platform_scraper` 任务成功率
   - 计算整体数据流入健康率（目标 ≥95%）

2. 新建 `apps/dashboard/src/pages/collection-dashboard/CollectionDashboardPage.tsx`：
   - 平台卡片（状态/最后采集时间/7天数据量/mini bar chart）
   - 健康率 banner（显示是否达到 ≥95% 目标）
   - 手动触发按钮（全平台采集 + social_media_raw 同步）

3. 在 `apps/api/features/system-hub/index.ts` 注册路由 `/collection-dashboard` 和导航子项。

## 下次预防

- [ ] Brain 运行在 `/Users/administrator/perfect21/cecelia/`（主仓库），worktree 改动需 PR 合并后才生效，**不能直接 curl 验证**；DoD 测试必须用 `node -e "readFileSync..."` 文件内容检查。
- [ ] `platform_scraper` 不在 tasks 表 task_type 约束中，若日后需要正式追踪采集任务状态，需在迁移中添加该类型。
- [ ] `content_analytics` 当前为空（采集尚未运行），仪表盘会显示"无数据"，属正常初始状态。
