# Learning: content pipeline 子任务被 dispatch 系统抢占

## 根本原因

`tick.js` 的 `selectNextDispatchableTask` 查询只排除了 `content-export`，未排除其他 content 子任务类型（`content-research`/`content-copywriting`/`content-copy-review`/`content-generate`/`content-image-review`）。

这些任务在设计上应该由 Brain 本地的 `executeQueuedContentTasks` executor 执行（使用 Claude API via `callLLM`），但 dispatch 系统优先抢占它们，发送给 Xian Codex。Codex quota 耗尽后任务失败，达到重试上限后进入 quarantine 状态，导致 content pipeline 全面阻塞。

## 下次预防

- [ ] 每次新增 content pipeline 阶段（新 task_type）时，同步检查 `selectNextDispatchableTask` 的排除列表
- [ ] 新增 executor-only 任务类型时，必须在 dispatch 查询的 `NOT IN` 列表中注册
- [ ] `content_publish` 是例外——它需要 dispatch（浏览器 CDP 发布），不应排除
