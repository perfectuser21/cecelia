# Learning: 内容选题触发窗口过窄导致每日内容 0 产出

## 根本原因

`topic-selection-scheduler.js` 的触发窗口只有 5 分钟（UTC 01:00-01:05 = 北京时间 09:00-09:05）。Brain tick 在此窗口内若因任何原因未成功运行（LLM 调用失败、tick 崩溃、服务重启等），当天剩余 19+ 小时内不再重试，导致当日 0 条内容产出。

具体触发链路：每日 09:00 CST → `triggerDailyTopicSelection` → `generateTopics`（Claude LLM）→ 创建 10 个 content-pipeline 任务 → Brain tick 内联执行 6 阶段流水线（research→copywriting→review→generate→image-review→export）→ 创建发布任务。

## 下次预防

- [ ] 触发窗口要足够宽以应对临时故障，由 `hasTodayTopics()` 负责幂等（已有任务则跳过）
- [ ] 新增关键时间窗口调度时，补偿窗口要覆盖业务截止时间（本例：UTC 12:00 = 北京 20:00 前）
- [ ] `TRIGGER_WINDOW_MINUTES` 这类"细窗口"常量要配套"catch-up 截止"常量，避免遗漏
- [ ] 每日必产内容 KR 依赖单点触发逻辑时，要添加监控告警（如 UTC 04:00 前未生成选题则报警）
