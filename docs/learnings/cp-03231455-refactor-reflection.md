# Learning: 重构 reflection.runReflection（圈复杂度 39 → 12）

**分支**: cp-03231455-964423f6-9ee8-486e-826e-ea54ba
**日期**: 2026-03-23

## 变更摘要

对 `packages/brain/src/desire/reflection.js` 中的 `runReflection` 函数进行纯重构，
通过提取子函数将其圈复杂度从 39 降至 12。

### 根本原因

`runReflection` 函数同时承担了 7 个职责：
1. 静默期检查与清除
2. Accumulator 阈值校验
3. 记忆获取与 Jaccard 去重
4. LLM 调用
5. 熔断器逻辑（连续重复检测）
6. Jaccard 相似度去重
7. 洞察写入与 accumulator 重置

其中步骤 5 和 6 各自有"进入静默期"的逻辑，导致大量重复代码。

### 重构策略

提取了以下子函数（所有行为完全不变）：

| 函数 | 职责 |
|------|------|
| `_checkAndClearSilencePeriod(pool)` | 静默期检查 + 过期自动清除 |
| `_deduplicateMemories(memories)` | 纯函数：Jaccard 去重 |
| `_fetchAndDeduplicateMemories(pool)` | 取记忆 + 去重 |
| `_tokenize(text)` | 中英文分词（bigram + word） |
| `_computeMaxSimilarity(insight, recentInsights)` | 计算最大 Jaccard 相似度 |
| `_enterSilencePeriodIfNeeded(pool)` | 连续跳过达阈值 → 进入静默期（消除重复） |
| `_resetAccumulator(pool, accumulator)` | 重置 accumulator |
| `_handleCircuitBreaker(pool, currentHash, accumulator)` | 熔断器触发处理 |
| `_handleJaccardDedup(pool, maxSimilarity, accumulator)` | Jaccard 去重跳过处理 |
| `_checkInsightDedup(pool, insight, accumulator)` | 组合：哈希熔断 + Jaccard 相似度 |
| `_writeInsight(pool, insight)` | 写入洞察 + 重置跳过计数 |

### 下次预防

- [ ] 函数超过 50 行时主动拆分，不等复杂度扫描触发
- [ ] 两处相同逻辑首次出现时立即提取为共享函数（DRY 原则）
- [ ] 复杂函数重构时优先提取纯函数（无副作用），便于测试

## 测试结果

reflection 模块所有 11 个测试通过。
