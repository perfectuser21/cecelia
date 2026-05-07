# PRD — fix(brain): embedding-service OpenAI quota 防护

## 背景 / 问题

OpenAI quota 已耗尽，但 `backfillLearningEmbeddings` 仍持续调用 generateEmbedding，每次都 429 失败。每次 backfill cycle（启动时 + 周期触发）跑 50 条 learnings × 200ms × N 批 → 每分钟刷十多条 `[embedding-service] backfill failed ... OpenAI quota exceeded` 到 brain-error.log。

实测：brain-error.log 中超过 95% 错误行是这条。这些"non-fatal"错误污染日志，掩盖真正的问题信号，且白白消耗 OpenAI 429 quota（虽然不计费但有 retry-after 头）。

## 成功标准

- **SC-001**: 检测到 quota 错误（429 / insufficient_quota / "exceeded your current quota"）
- **SC-002**: 单批 backfill 内连续 3 次 quota 错误 → 立即中止整轮
- **SC-003**: 进入 1 小时冷却期，期间 backfill 直接跳过返回 `quota_skipped: true`
- **SC-004**: brain-error.log 中 OpenAI quota 类错误行数显著下降（从每分钟 N 行 → 每小时 0 行 in cooldown）

## 范围限定

**在范围内**：
- 加 `isQuotaError(err)` 识别函数
- 加 `isInQuotaCooldown()` + `_resetQuotaCooldown()`（测试用）
- backfillLearningEmbeddings 集成 quota 退避逻辑
- 单元测试覆盖 4 个新 case

**不在范围内**：
- 迁移 OpenAI → Claude/sentence-transformer（架构改造，单独 PR）
- 修复 `generateTaskEmbeddingAsync` / `generateMemoryStreamEmbeddingAsync` 的 quota 退避（后续可加，本 PR 聚焦 backfill）
- 重试队列消费（已存在 working_memory.embedding_retry_queue 但没人消费，独立问题）

## DoD（验收）

- [x] [ARTIFACT] `packages/brain/src/embedding-service.js` 新增 `isQuotaError` / `isInQuotaCooldown` / `_resetQuotaCooldown` export
- [x] [ARTIFACT] `packages/brain/src/embedding-service.js` `backfillLearningEmbeddings` 接入退避逻辑
- [x] [BEHAVIOR] tests/embedding-service-backfill: 4 个新 it（T7 isQuotaError 识别 / T8 默认无 cooldown / T9 3 次 quota 触发 cooldown / T10 cooldown 期跳过）

## 受影响文件

- `packages/brain/src/embedding-service.js` — 新增 quota 退避机制
- `packages/brain/src/__tests__/embedding-service-backfill.test.js` — 新增 4 个 it

## 部署后验证

merge + Brain 重启后：
1. `tail -f logs/brain-error.log | grep "OpenAI quota exceeded" | wc -l` 1 小时内应该明显下降（从持续刷到 < 10）
2. brain.log 中应该看到 `[embedding-service] OpenAI quota exhausted ... 暂停 backfill 60min` 一次后停
3. 若 quota 充值恢复，1 小时后下次 backfill 自动重启
