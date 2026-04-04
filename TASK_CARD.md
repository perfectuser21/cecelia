# Task Card: fix(brain): 修复 Scanner success_rate 误报 + content executor 阻塞 Brain 事件循环

## 问题

### 问题 1: Scanner 能力误判为 failing（false positive）
- **现象**: Scanner 持续报告 "OKR 执行流程 - 端到端" 为 failing，触发不必要的 SelfDrive 自修复循环
- **根因**: `collectSkillActivity` 遍历 related_skills 时用每个 skill 的 success_rate **覆盖**前一个值（last-wins 语义）。`/dev`(27/51=52%) 被 `/review`(0/1=0%) 覆盖 → 最终 success_rate=0 < 30 → 误判为 failing

### 问题 2: Content executor 在 Brain tick 中 await 阻塞事件循环
- **现象**: Brain HTTP 在 content pipeline tick 期间完全不响应（最长 7.5 分钟），外部 trigger-cecelia 调用超时
- **根因**: tick.js 中 `await executeQueuedContentTasks()` 阻塞执行；内部 `executeResearch` 用 `execSync` 调 NotebookLM（最长 330s）、`executeCopywriting` 调 LLM（最长 120s），`execSync` 冻结整个 Node.js 事件循环

## 修复

1. **capability-scanner.js**: `collectSkillActivity` 改为累加所有 skill 的 total/completed，最终一次性计算加权成功率
2. **content-pipeline-orchestrator.js**: 添加 `_contentExecutorBusy` 并发守卫，防止多 tick 重叠执行；用 try/finally 确保释放标志
3. **tick.js**: `executeQueuedContentTasks()` 改为 fire-and-forget（移除 `await`），避免阻塞 tick 主流程

## 成功标准

- [x] Scanner 对 "OKR 执行流程 - 端到端" 的 success_rate 计算为 51%(27+0)/(51+1) = 52%，不再被误报为 failing
- [x] `executeQueuedContentTasks` 有并发守卫（`_contentExecutorBusy` 标志）
- [x] tick.js 中 content executor 调用为 fire-and-forget（不 await）
