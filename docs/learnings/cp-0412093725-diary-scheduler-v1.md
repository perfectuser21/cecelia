### 根本原因

diary-scheduler.js 原版本只输出 PR/决策/完成任务数，缺少 KR 进度和失败告警两个核心板块。`shouldGenerateDiary()` 未导出，测试无法覆盖。

### 下次预防

- [ ] 新增模块时，所有可测试的纯函数（buildXxx、shouldXxx）必须 export
- [ ] 定时调度模块的函数签名设计时应考虑可测性（接受 pool 和 now 参数，而非硬编码全局调用）
- [ ] 日报内容类模块的 DoD 应包含"内容包含特定关键字"的可执行测试
