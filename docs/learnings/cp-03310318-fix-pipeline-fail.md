# Learning: 修复 content pipeline orchestrator 忽略阶段失败

## 任务
修复 `STAGE_HANDLER_MAP` 中 4 个非审核阶段忽略 `taskStatus` 的 Bug。

### 根本原因
`STAGE_HANDLER_MAP` 中 `content-research`、`content-copywriting`、`content-generate`、`content-export`
的 lambda 签名使用 `_s` 丢弃 `taskStatus` 参数，导致阶段失败时仍推进 pipeline。
`content-copy-review`/`content-image-review` 因为内部有 `_isReviewPassed` 检查而不受影响。

### 下次预防
- [ ] 添加新的 STAGE_HANDLER_MAP 阶段时，确保 `taskStatus` 参数被实际使用
- [ ] 非审核阶段的处理器统一模式：`(ctx, status, _f, db) => status === 'failed' ? _markPipelineFailed(...) : _handleXxx(...)`
- [ ] 在 executor 调用 `advanceContentPipeline` 时已正确传入 `newStatus`，问题在 handler 侧未消费
