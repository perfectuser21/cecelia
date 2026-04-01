## fix-pipeline-failed-reset：content-pipeline failed 被 healing 无限重置（2026-04-01）

### 根本原因

`healing.js` 的 `retryWithBackoff()` 扫描所有 `status=failed AND payload->>'retry_count' IS NOT NULL` 的任务并将其重置为 `queued`。
这个机制本意是重试 transient 失败的任务，但它没有区分"transient 失败"和"pipeline 内部终态失败"。
content-pipeline 达到 copy-review/image-review 最大重试次数（MAX_REVIEW_RETRY=3）后被标记 `failed` 时，payload 里没有设置 `failure_class`，因此 healing 将其误判为可重试任务，重置为 `queued`，触发 `orchestrateContentPipelines` 重新创建 content-research 子任务，导致 pipeline 无限循环重启。

### 下次预防

- [ ] 所有将任务标记为"终态 failed"（不应被系统自动重试）的代码，必须在 payload 中写入 `failure_class: '<reason>'`，并在 `NON_RETRYABLE_FAILURE_CLASSES` 中注册该 class
- [ ] 新增 pipeline 终态标记时，检查 healing.retryWithBackoff 是否会意外 pick up 该任务
- [ ] 新增任务类型时，如果该类型有内部重试机制，应在设计时明确其 failure_class 策略
