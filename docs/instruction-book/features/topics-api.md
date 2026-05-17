# GET /api/brain/topics — 内容选题候选库 API

## 用途

查询 `topic_selection_log` 表中的内容选题候选记录。

## 端点

```
GET /api/brain/topics
GET /api/brain/topics?date=YYYY-MM-DD
```

## 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `date` | string（可选）| 指定日期（YYYY-MM-DD），默认返回今日 |

## 响应

```json
{
  "data": [...],
  "date": "2026-04-01",
  "total": 10
}
```

## 数据字段

`data` 数组中每条记录包含：
- `id` — 记录 ID
- `selected_date` — 选题日期
- `keyword` — 核心关键词
- `content_type` — 内容类型
- `title_candidates` — 标题备选（JSON 数组）
- `hook` — 开头钩子文案
- `why_hot` — 选题理由
- `priority_score` — 优先级分数（0-1）
- `created_at` — 创建时间

## 关联

- 选题由 `topic-selector.js` + `topic-selection-scheduler.js` 每日 UTC 01:00 自动生成
- 通过 `POST /api/brain/pipelines/trigger-topics` 可手动触发选题
