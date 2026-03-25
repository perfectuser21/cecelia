# Learning: memory-retriever salience 加权召回（PR11）

**Branch**: cp-03241849-cd792699-4629-468a-a17c-203675
**Date**: 2026-03-25

---

### 根本原因

PR9 引入了 `salience_score` 字段到 `memory_stream` 表，但 memory-retriever.js 的评分公式未消费该字段。`loadConversationHistory` 虽然 SELECT 了 `salience_score`，但只将其折叠进 `relevance` 字段（`relevance: r.salience_score || 0.5`），没有作为独立的 `salience_score` 字段传入候选对象供评分公式使用。`searchEpisodicMemory` 的向量路径已在 PR9 对应修复中添加了 `salience_score`，但 Jaccard 降级路径遗漏了。

### 修复方法

1. 新增 `SALIENCE_WEIGHT = 0.3` 导出常量（文档化、可测试）
2. `loadConversationHistory` 候选对象加 `salience_score: r.salience_score || 0`（独立字段）
3. `searchEpisodicMemory` Jaccard 路径候选对象补充 `salience_score: row.salience_score || 0`
4. 评分公式加入 `salienceW = 1 + (c.salience_score || 0) * SALIENCE_WEIGHT`，乘入 finalScore

### 下次预防

- [ ] 每次向 `memory_stream` 添加新字段时，同步检查 memory-retriever.js 各数据路径是否消费该字段
- [ ] 在 memory-retriever.js 顶部注释中维护"已使用的 memory_stream 字段"清单
- [ ] 向量路径和 Jaccard 降级路径的 SELECT + 候选对象结构必须保持一致（两处对称检查）
- [ ] 新建测试 `memory-retriever-salience.test.js` 作为 regression 防线，防止加权逻辑被意外删除
