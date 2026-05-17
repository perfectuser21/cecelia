# Learning: 记忆系统 PR11 — OUT filter salience 加权召回

## 背景

PR9 引入了 `salience_score` 字段到 `memory_stream`，用于 IN filter 标记高价值消息。但 `memory-retriever.js` 的 `finalScore` 公式未使用该字段，导致高 salience 记忆在召回排序中没有优先权。

## 根本原因

`finalScore` 的计算公式为 `relevance × timeDecay × modeW × dynW`，缺少 salience 维度。`salience_score` 虽然在 `loadConversationHistory` 中被当作 `relevance` 使用，但：
1. episodic 路径（searchEpisodicMemory）的 SQL 未查询 salience_score 列
2. 统一评分公式未引用 salience_score
3. semantic/task 路径的候选数据结构本身不含 salience_score（该字段属于 memory_stream，不是 tasks 表）

## 解决方案

1. 新增 `SALIENCE_WEIGHT = 0.5` 常量（导出，便于测试和调整）
2. episodic 路径（向量 + Jaccard 两条路）的 SQL 补充 `salience_score` 列，并在候选构建时透传
3. 评分公式加入 salienceBoost：`finalScore = relevance × timeDecay × modeW × dynW × (1 + (salience_score || 0) × SALIENCE_WEIGHT)`
4. `|| 0` 保证旧数据（null/undefined）向后兼容，salienceBoost = 1，不影响评分

## 下次预防

- [ ] 新增字段到 memory_stream 时，同步检查 memory-retriever.js 的所有 SQL 查询是否透传该字段
- [ ] 评分公式修改需同步更新测试（D11 系列）验证新维度的效果
- [ ] task/learning/event 候选来自非 memory_stream 路径，不含 salience_score，`|| 0` 处理即可
- [ ] SALIENCE_WEIGHT 常量导出，便于未来调参和测试引用
