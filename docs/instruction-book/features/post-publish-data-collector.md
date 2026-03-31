---
id: instruction-post-publish-data-collector
version: 1.0.0
created: 2026-03-30
updated: 2026-03-30
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本 — 发布后数据回收，pipeline_publish_stats + /stats API
---

# Post-Publish Data Collector — 发布后数据回收

## What it is

content_publish 任务完成满 4 小时后，Brain tick 自动触发对应平台的 scraper 脚本，将阅读/点赞/评论/分享等互动数据写入 `pipeline_publish_stats` 表，并通过 API 对外暴露。

## API

```
GET /api/brain/pipelines/:id/stats
```

返回示例：

```json
{
  "pipeline_id": "abc123",
  "stats": [
    {
      "platform": "douyin",
      "views": 1200,
      "likes": 88,
      "comments": 12,
      "shares": 5,
      "scraped_at": "2026-03-30T10:00:00Z"
    }
  ]
}
```

当某 pipeline 下尚无采集记录时，返回 `"stats": []`（不报错）。

## How it works

1. Brain tick 每 5 分钟执行一次 `collectPostPublishData(pool)`
2. 查询 `content_publish` 类型任务中，`completed_at <= NOW() - INTERVAL '4 hours'` 且无 `pipeline_publish_stats` 记录的条目
3. 以 fire-and-forget 方式 `spawn('node', [scraperPath])` 触发对应平台 scraper
4. 读取 `zenithjoy.publish_logs.metrics`，UPSERT 写入 `pipeline_publish_stats`

## 支持平台

douyin / kuaishou / xiaohongshu / toutiao / weibo / zhihu / channels / wechat（共 8 个）

## 注意事项

- scraper 依赖远程浏览器（CDP，100.97.242.124:19222），Brain tick 只负责触发，不等待 scraper 完成
- 4 小时延迟是产品设计，不支持手动触发（本期）
- `pipeline_publish_stats` 以 `(pipeline_id, platform)` 为唯一键，重复触发幂等安全
