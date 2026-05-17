### 根本原因

`preparePrompt()` 在 executor.js 中对 `harness_report` 和 `sprint_report` 没有显式处理分支，导致 fallthrough 到 `_prepareDefaultPrompt(task, skill)`，而 `getSkillForTaskType()` 的 `skillMap` 里也没有这两个类型，最终返回 `/dev` fallback。每次 harness pipeline 运行完 generator，report 任务都会错误地使用 `/dev` skill 而不是 `/harness-report`。

### 下次预防

- [ ] 新增 task_type 时，必须同时在 `preparePrompt()` 添加显式处理分支（或在 `skillMap` 里添加映射）
- [ ] harness pipeline 每个 task_type 必须有固定 skill 路由，禁止依赖 `/dev` fallback
