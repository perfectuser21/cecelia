# 选题候选库 API

## 用途

查询 `content_topics` 表中的 AI 自动选题候选记录，以及今日选题决策结果。

## 端点

```
GET /api/brain/topics               — 候选库列表
GET /api/brain/topics/today         — 今日决策输出
```

---

## GET /api/brain/topics

查询选题候选库，支持按状态过滤。

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `status` | string（可选）| 过滤状态：`pending` / `adopted` / `skipped` |
| `limit` | integer（可选）| 返回数量上限，默认 20，最大 100 |

### 响应

```json
{
  "topics": [
    {
      "id": "uuid",
      "title": "选题标题",
      "hook": "钩子文案",
      "ai_score": 8.5,
      "score_reason": "AI 评分原因",
      "source": "ai_daily_selection",
      "status": "adopted",
      "adopted_at": "2026-04-01T09:00:00Z",
      "created_at": "2026-04-01T01:00:00Z"
    }
  ],
  "total": 10
}
```

---

## GET /api/brain/topics/today

返回今日（北京时间）的选题决策结果：已采纳列表 + 待审核数量。

### 响应

```json
{
  "date": "2026-04-01",
  "adopted": [
    {
      "id": "uuid",
      "title": "选题标题",
      "hook": "钩子文案",
      "ai_score": 8.5,
      "score_reason": "AI 评分原因",
      "adopted_at": "2026-04-01T09:00:00Z"
    }
  ],
  "pending_count": 5
}
```

---

## 数据字段说明

| 字段 | 说明 |
|------|------|
| `source` | 来源：`ai_daily_selection`（每日调度）/ `manual_capture`（手动录入） |
| `status` | 状态：`pending`（待审）/ `adopted`（已采纳）/ `skipped`（已跳过）|
| `ai_score` | AI 评分，0-10 分制，保留 1 位小数 |
| `score_reason` | AI 评分理由（来自 `why_hot` 字段）|

## 关联流程

每日 UTC 01:00（北京 09:00），`topic-selection-scheduler.js` 自动：
1. 生成 10 个选题并写入 `content_topics`（`source = 'ai_daily_selection'`）
2. 按 `ai_score DESC` 自动采纳 top 5（`status = 'adopted'`）
3. 为采纳的选题创建 `content-pipeline` tasks
