# Learning: 数据采集 v1 - 多平台集成与验证

**任务**: [SelfDrive] [P1] 数据采集v1 - 多平台集成与验证  
**分支**: cp-04060821-d33d49cd-3ac5-471d-8e2e-875f77  
**日期**: 2026-04-06

## 交付内容

新增 `GET /api/brain/analytics/collection-dashboard` API，为采集仪表盘提供：
- 各平台每日数据量（N 天历史，day-by-day 明细）
- 采集任务失败率（基于 platform_scraper 任务状态统计）
- 平均采集延迟（task created → completed 分钟数）
- 全平台数据正常率（有数据的 platform-day / 总 platform-day）

### 根本原因

之前系统已有 `daily-scrape-scheduler.js`（调度采集任务）、`social-media-sync.js`（同步数据）、`content_analytics` 表（存储采集结果），但缺少一个聚合接口将"数据量 + 失败率 + 延迟"合并展示。

### 下次预防

- [ ] 新增分析 API 前先检查 `routes/analytics.js` 是否已有类似端点，避免重复
- [ ] platform_scraper 任务的 payload 字段 `platform` 是 key，统计时需用 `payload->>'platform'` 查询
- [ ] 测试文件需要 mock 所有 analytics.js 导入的模块（共 8 个），否则模块加载失败
