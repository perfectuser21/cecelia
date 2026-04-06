# [SelfDrive] 选题决策反馈系统 v1 (2026-04-06)

### 根本原因

数据闭环缺少"反向归因"步骤：`pipeline_publish_stats` 存储了平台互动数据，但没有从互动数据反向追溯到原始话题关键词，导致每周选题决策无法基于实际表现数据做优化。

### 解决方案

1. 新建 `topic-heat-scorer.js`：通过 `publish_task_id → tasks → pipeline_id → content_pipeline.payload.topic` 的 JOIN 链路，将平台互动数据归因到话题维度，加权公式：`views*0.1 + likes*3 + comments*5 + shares*7`（转发权重最高，反映主动传播价值）

2. 新增 `topic_decision_feedback` 表（migration 214）：每周话题热度快照，高热记录（heat_score ≥ 60）在下次选题时注入 Prompt 作为正向参考

3. `weekly-report-generator.js` 增加"爆款主题"和"下周推荐方向"两个板块，调用 `saveTopicFeedback` 写入反馈表（non-blocking，不影响主流程）

4. `topic-selector.js` 调用 `getHighPerformingTopics` 查询近 4 周高热话题，注入 Prompt 的"有实证的高热话题方向"段落

### 下次预防

- [ ] JOIN 链路涉及多级关联（publish_task → pipeline_task），务必用 `LEFT JOIN + COALESCE` 而非 `INNER JOIN`，避免因 payload 字段名不一致（`pipeline_id` vs `parent_pipeline_id`）导致漏数据
- [ ] 新增 migration 后立即更新 `selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION` 和 `DEFINITION.md`，否则 facts-check 失败阻塞 DevGate
- [ ] 给 weekly-report-generator 增加新板块时，使用默认参数（`topicHeatData = []`）保证向后兼容，现有测试无需修改调用点
