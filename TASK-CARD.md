# Task Card: [SelfDrive] [数据闭环] 选题决策反馈系统 v1

## 目标
实现内容发布数据（点赞/评论/分享）→ 选题热度评分 → 下周选题推荐的完整反馈闭环。

## 实现范围

### 1. DB Migration（214_topic_decision_feedback.sql）
新增 `topic_decision_feedback` 表，存储每周话题热度评分和推荐记录：
- `week_key` — YYYY-WNN
- `topic_keyword` — 话题关键词
- `heat_score` — 综合热度分（0-100）
- `total_likes/comments/shares/views` — 汇总指标
- `recommended_next_week` — 是否推荐为下周方向

### 2. topic-heat-scorer.js（新文件）
- `computeTopicHeatScores(pool, start, end)` — 聚合 pipeline_publish_stats 到话题级别
- 热度公式：`views*0.1 + likes*3 + comments*5 + shares*7`，归一化到0-100
- `saveTopicFeedback(pool, weekKey, scoredTopics)` — 写入 topic_decision_feedback

### 3. weekly-report-generator.js（修改）
- 调用 topic-heat-scorer 获取本周爆款话题 TOP 5
- 在周报中增加"爆款主题"和"下周推荐方向"两个板块

### 4. topic-selector.js（修改）
- 新增 `getHighPerformingTopics(pool)` 查询近4周 heat_score > 60 的历史话题
- 将高热话题作为正向参考注入选题 Prompt

## DoD

- [x] [ARTIFACT] `packages/brain/migrations/214_topic_decision_feedback.sql` 文件存在
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/migrations/214_topic_decision_feedback.sql')"`

- [x] [ARTIFACT] `packages/brain/src/topic-heat-scorer.js` 文件存在且导出 computeTopicHeatScores 和 saveTopicFeedback
  - Test: `manual:node -e "const m=require('./packages/brain/src/topic-heat-scorer.js');if(!m.computeTopicHeatScores||!m.saveTopicFeedback)process.exit(1)"`

- [x] [BEHAVIOR] topic-heat-scorer 热度公式正确（views*0.1 + likes*3 + comments*5 + shares*7，归一化到0-100）
  - Test: `tests/topic-heat-scorer.test.ts`

- [x] [BEHAVIOR] weekly-report-generator 周报文本包含"爆款主题"板块
  - Test: `tests/weekly-report-generator.test.ts`

- [x] [BEHAVIOR] topic-selector 的 Prompt 包含高热话题正向参考
  - Test: `tests/topic-heat-scorer.test.ts`
