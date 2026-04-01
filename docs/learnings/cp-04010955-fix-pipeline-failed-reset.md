## fix-pipeline-failed-reset：content-pipeline failed 被 healing 无限重置（2026-04-01）

### 根本原因

`healing.js` 的 `retryWithBackoff()` 扫描所有 `status=failed AND payload->>'retry_count' IS NOT NULL` 的任务并重置为 `queued`，不区分"transient 失败需重试"和"pipeline 内部终态失败"。
content-pipeline 达到 copy-review/image-review 最大重试次数被标记 `failed` 时，payload 里没有 `failure_class`，因此被 healing 误当成可重试任务，导致无限循环重启。

### 下次预防

- [ ] 所有将任务标记为"终态 failed"（不应被系统自动重试）的代码，必须在 payload 中写入 `failure_class: '<reason>'`，并在 `NON_RETRYABLE_FAILURE_CLASSES` 中注册该 class
- [ ] 新增 pipeline 终态标记时，检查 healing.retryWithBackoff 是否会意外 pick up 该任务
