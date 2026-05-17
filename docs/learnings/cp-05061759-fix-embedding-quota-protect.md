# Learning: cp-05061759-fix-embedding-quota-protect

## 事件

OpenAI quota 耗尽后，`backfillLearningEmbeddings` 持续调用 generateEmbedding，每次 429 失败 + warn 日志，brain-error.log 95% 错误行都是这条噪音，掩盖真问题。

## 根本原因

**外部依赖失败时缺乏退避**。代码只 try/catch 个错误继续下一条，假设错误是临时的（普通 rate limit）。但 quota 类错误是**长期的**——quota 重置要等几小时到月底，期间持续打 API 完全无意义，只增加噪音。

更深层：**没有"健康降级"概念**。要么 100% 跑（all OK）要么静默 retry forever（all degraded）。中间应该有"识别 → 暂停 → 等待 → 重试"的状态机。

## 下次预防

- [ ] **任何外部依赖必须有 cooldown / circuit breaker**：HTTP 429 / quota / auth 类错误应该立即触发暂停，不能 retry forever
- [ ] **错误分类驱动退避策略**：临时错误（network timeout / rate limit）短退避，永久错误（quota / auth）长退避或 disable
- [ ] **noisy log 必须有 deduplication**：相同 error message 累积超过 N 次 → 改 debug 级别（per-cycle 1 次 summary 即可）
- [ ] **加厚先减肥**：本 PR 0→thin，加退避机制。后续若引入完整 circuit breaker（套用 circuit-breaker.js）必须先删本 PR 的简化版退避变量（_quotaCooldownUntil + isInQuotaCooldown），用统一框架代替
- [ ] **Walking Skeleton 视角**：本 PR 是 MJ4 自主神经的"外部依赖健康"加厚段。0→thin 修复噪音，thin→medium 应当扩展到所有外部 LLM/API 都有 circuit breaker
