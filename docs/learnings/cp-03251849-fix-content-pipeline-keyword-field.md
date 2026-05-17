# Learning: content-pipeline 成功率崩溃（payload 字段名不匹配）

**Branch**: cp-03251849-cf3cb5df-5772-4404-b0f7-1c3cb4
**Date**: 2026-03-26
**PR**: #1577

### 根本原因

`_parsePipelineParams` 中使用了错误的字段名 `payload.keyword`，
而 Brain 实际注入的字段名是 `payload.pipeline_keyword`。

导致链式失败：
1. keyword 回落到完整 task title（含 `[内容流水线]` 前缀 + 日期后缀）
2. `executeGenerate` 用错误 keyword 生成模板内容，极短（copy ~170字符 < 300，article ~290字符 < 1000）
3. `executeReview` 长度检查失败，`review_passed = false`
4. 4 次 review 全部失败，触发 `MAX_REVIEW_RETRY=3`，pipeline 标记 `failed`
5. 10 个 pipeline 连续失败，Brain 1小时成功率跌至 24%

### 下次预防

- [ ] 新增 payload 字段时，**必须同时检查所有读取方**（orchestrator/executor/router）使用相同字段名
- [ ] executor 的 `keyword = task.payload?.pipeline_keyword || task.title` 已经是正确写法，`orchestrator` 在创建子任务前提取 keyword 时必须与 executor 侧保持一致
- [ ] 无 findings 的 fallback 路径需要保证最低内容质量（≥300 copy，≥1000 article），review 检查标准是硬门禁
- [ ] 当所有同类型任务在同一时间窗口全部失败时，应优先排查 payload 字段名/格式变化（系统性 Bug，非个别失败）
