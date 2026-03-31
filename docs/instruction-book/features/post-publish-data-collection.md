# 功能说明：发布后数据回收（内容飞轮 I3）

## 功能概述

内容飞轮 I3：`content_publish` 任务完成 4 小时后，Brain 自动触发对应平台的 scraper 任务，将采集的阅读/点赞/评论/分享等指标写入 `pipeline_publish_stats` 表，并通过 API 暴露给上层消费。

## 触发机制

- **触发条件**：content_publish 任务状态为 completed，且 completed_at < NOW() - 4h
- **去重保护**：检查是否已存在对应的 platform_scraper 任务（通过 source_publish_task_id 匹配），避免重复派发
- **派发方式**：通过 Brain 任务队列（task_type = platform_scraper），不直接调用 scraper 脚本
- **执行频率**：每 tick 扫描一次，每次最多处理 20 条任务

## API 接口

```
GET /api/brain/pipelines/:id/stats
```

**响应格式**：

```json
{
  "pipeline_id": "...",
  "stats": [
    {
      "platform": "douyin",
      "views": 12000,
      "likes": 450,
      "comments": 38,
      "shares": 15,
      "last_scraped_at": "2026-03-31T08:00:00Z",
      "scrape_count": 1
    }
  ]
}
```

## 数据表

`pipeline_publish_stats`（migration 207）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| pipeline_id | UUID | 所属 pipeline |
| publish_task_id | UUID | 原始发布任务 ID |
| platform | VARCHAR(64) | 平台名称 |
| views | BIGINT | 播放/阅读数 |
| likes | BIGINT | 点赞数 |
| comments | BIGINT | 评论数 |
| shares | BIGINT | 分享数 |
| scraped_at | TIMESTAMPTZ | 采集时间 |

## 核心文件

- `packages/brain/src/post-publish-data-collector.js` — 主模块
- `packages/brain/migrations/207_pipeline_publish_stats.sql` — 数据表
- `packages/brain/src/routes/content-pipeline.js` — stats 路由实现
