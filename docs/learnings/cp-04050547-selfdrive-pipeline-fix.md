# Learning: 内容生成+发布链路双 Bug 修复

## 背景
P0 SelfDrive 诊断任务：内容流水线 copy-review 重试达上限（3次），发布任务（content_publish）永久卡在 queued。

## 根本原因

### Bug 1: copy-review 反馈丢失导致无限重试循环
`content-pipeline-orchestrator.js` 在重试 copywriting 时，将 LLM 审查反馈写入 `task.payload.review_feedback`，但 `content-pipeline-executors.js` 的 `executeCopywriting` 函数读取的是 `task.payload.previous_feedback`。字段名不一致导致每次重试 LLM 收不到改进意见，生成相同的低质量内容，最终耗尽 3 次重试额度让 pipeline 失败。

### Bug 2: content_publish 任务被 pre-flight check 永久拒绝
`_createPublishJobs` 创建的 `content_publish` 任务没有 `description` 字段，而 `pre-flight-check.js` 对非系统任务要求 description 不为空。`content_publish` 未被列入 `SYSTEM_TASK_TYPES`，导致每次调度都被 pre-flight 拒绝，任务永久卡在 `queued`。

## 下次预防

- [ ] orchestrator 与 executor 之间通过 payload 传递数据时，字段名必须保持一致（建议用常量）
- [ ] 系统自动生成的 task（pipeline 子任务、发布任务等）需在 pre-flight-check 的 `SYSTEM_TASK_TYPES` 中豁免，否则会被无限 reject
- [ ] 新增 task_type 时，同步检查：(1) 是否需要加入 `SYSTEM_TASK_TYPES`，(2) 是否在 `EXECUTOR_MAP`/`PIPELINE_STAGES` 中，(3) 是否在 `selectNextDispatchableTask` 的排除列表中
