# GET /api/brain/topics — 内容选题候选库 API

## 用途

查询 `topic_selection_log` 表中的历史内容选题记录。当前选题生成与人工审核使用 `topic_suggestions` 推荐队列，不由此查询接口触发。

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

### 当前生成与审核

`ContentStudio` 调用 `POST /api/brain/topics/generate` 生成选题。请求可带 `{ "date": "YYYY-MM-DD" }`，省略时使用今日日期；接口通过 `topic-selector.js` 生成候选并保存到 `topic_suggestions`，状态为 `pending`。

响应包含 `{ "ok": true, "triggered": 5, "total_generated": 5, "date": "YYYY-MM-DD" }`，数量以实际生成为准。该接口不直接创建内容流水线任务，也不更新本页查询的历史日志。

- `GET /api/brain/topics/suggestions`：查看推荐队列。
- `POST /api/brain/topics/suggestions/:id/approve`：人工批准并创建内容流水线任务。
- `POST /api/brain/topics/suggestions/:id/reject`：拒绝推荐。

### 已退役触发入口

以下旧入口统一返回 HTTP 410，错误码为 `CONTENT_TRIGGER_RETIRED`，不生成选题、不创建内容任务。响应中的 `successor` 指向 `/api/brain/topics/generate`。

- `POST /api/brain/pipelines/trigger-topics`
- `POST /api/brain/pipelines/e2e-trigger`
- `POST /api/brain/pipelines/batch-e2e-trigger`

旧每日选题调度器及其硬编码种子库已移除；Brain Tick 不再自动生成每日选题。
