# Learning: escalation cancel_pending 误取消 content pipeline 子任务

## 背景
Content pipeline 运行时前台显示"永远等待中"，pipeline 卡在 `in_progress` 永不完成。

### 根本原因
`cancelPendingTasks` 的 `task_type NOT IN` 排除列表只包含 `research` 和 `suggestion_plan`，
缺少 `content-copywriting` 等 content pipeline 子任务类型。
Escalation 定期执行 `cancel_pending` 动作时，会将所有 `queued` 的 content 子任务取消，
导致 pipeline 的下一阶段子任务（如重试 R3）一创建就被取消，pipeline 永久卡住。

### 修复方案
在排除列表中加入全部 content pipeline 子任务类型：
content-pipeline, content-research, content-copywriting, content-copy-review,
content-generate, content-image-review, content-export, content-publish

### 下次预防
- [ ] 新增 task_type 时，同步检查 cancelPendingTasks 排除列表是否需要更新
- [ ] content pipeline 相关 task_type 应统一维护在一个常量列表中，避免遗漏
