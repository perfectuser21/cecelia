# PRD: 内容选题调度器补偿窗口

## 背景

每日内容选题调度器（`topic-selection-scheduler.js`）触发窗口仅 5 分钟（UTC 01:00-01:05）。
若此窗口内 tick 未成功触发选题（LLM 调用失败/服务重启等），当天不再重试，导致 0 条内容产出。

## 方案

将触发窗口从 5 分钟扩展至 UTC 01:00-12:00（北京 09:00-20:00），由已有的
`hasTodayTopics()` 幂等检查防止重复触发。

## 成功标准

- [x] `isInTriggerWindow(UTC 10:00)` 返回 true（补偿窗口内触发）
- [x] `isInTriggerWindow(UTC 13:00)` 返回 false（超过截止时间）
- [x] 已有今日任务时 `hasTodayTopics` 阻断二次触发（幂等）
- [x] 10 个已有单元测试全部通过，新增补偿窗口测试通过
