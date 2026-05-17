# Learning: 记忆系统 PR7 — 接入断链

Branch: cp-03250842-memory-wiring
Date: 2026-03-25

## 实现内容

修复两处记忆系统断链：
1. `tick.js` 新增 10.18 节：fire-and-forget 调用 `runSuggestionCycle(pool)`，使 desires→suggestions 路径每 tick 自动触发
2. `executor.js` 在 `updateTaskRunInfo` 后：fire-and-forget 调用 `recordExpectedReward(taskId, taskType, skill)`，建立 RPE 基线

## 根本原因

PR5/PR6 实现了函数但没有接入调用点：
- `runSuggestionCycle` 设计为"每 5 分钟调用"，但 tick.js 没有 import 它
- `recordExpectedReward` 需要在任务开始前建立基线，但 executor.js 没有在派发时调用

代码写完不等于功能完成——接入调用链是实现的一部分，缺少集成测试（验证调用链完整性）导致断链被忽略。

## 下次预防

- [ ] 新增 Brain 模块时，Task Card 应包含"接入 tick.js 或对应调用点"的 DoD 条目
- [ ] fire-and-forget 模式统一格式：`Promise.resolve().then(() => fn(pool)).catch(e => console.warn(...))`
- [ ] 集成断言测试（如 memory-wiring.test.js）应与新功能 PR 一起提交，而不是补丁 PR
