# Learning: 全平台内容效果数据采集 — 数据闭环

**任务**: [SelfDrive] [数据闭环] 全平台内容效果数据采集 — 浏览/互动/转化  
**分支**: cp-04052248-10438fc9-23f0-4e29-8e92-086d13  
**日期**: 2026-04-06

---

### 根本原因

`pipeline_publish_stats` 表只记录流水线发布后的单次指标快照，与 `pipeline_id` 强绑定，无法支持：
- 非流水线发布的内容（手动发布、历史内容）
- 同一内容的多次时序快照（发布后 4h / 24h / 72h 对比）
- 跨平台通用 ROI 计算

导致周报的"数据回收"板块数据稀疏，选题引擎无法获得可靠的历史表现数据。

### 解决方案

新建通用 `content_analytics` 表（Migration 215），解耦流水线与数据存储：
- 不依赖 `pipeline_id`（可选字段），支持任意来源
- 支持多次快照（时序追踪）
- 独立的 `content-analytics.js` 模块提供 CRUD + ROI 计算

周报新增"内容ROI"板块，计算每平台平均曝光和互动率（‰）。

### 下次预防

- [ ] 新增分析类表时优先考虑是否可扩展（不与 pipeline_id 强绑定）
- [ ] ROI 指标定义：`avg_views_per_content` + `engagement_rate`（互动/曝光 × 1000）
- [ ] 批量写入用 `bulkWriteContentAnalytics()` 而不是手写循环
- [ ] Brain migrations 编号从 `ls migrations/ | sort -n | tail -1` 确认，当前下一个是 215
- [ ] 测试文件必须在 push 前写好并通过（本次 9/9 通过）
