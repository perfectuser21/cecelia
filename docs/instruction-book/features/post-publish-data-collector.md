---
id: instruction-post-publish-data-collector
version: 1.0.0
created: 2026-03-31
updated: 2026-03-31
authority: INTERNAL
changelog:
  - 1.0.0: 初始版本 — 发布后数据回收（内容飞轮 I3）
---

# 发布后数据回收（Post-Publish Data Collector）

## What it is

内容飞轮的效果反馈环节。`content_publish` 任务完成 4 小时后，自动派发 `platform_scraper` 任务采集各平台的阅读/点赞/评论/分享数据，写入 `pipeline_publish_stats` 表。

## 核心模块

- `packages/brain/src/post-publish-data-collector.js` — 主模块，每 tick 执行
- `packages/brain/migrations/207_pipeline_publish_stats.sql` — 数据表

## API

```
GET /api/brain/pipelines/:id/stats
```

返回该 pipeline 各平台数据汇总（views/likes/comments/shares）。

## 触发机制

由 `tick.js` 的 fire-and-forget 区块调用 `schedulePostPublishCollection(pool)`。扫描完成超过 4 小时但尚未触发采集的 `content_publish` 任务，派发 `platform_scraper` 类型的 Brain 任务。
