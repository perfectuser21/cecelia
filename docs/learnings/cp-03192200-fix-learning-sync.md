# Learning: distill-learnings.js 与 learnings 表不同步

## 问题

`distill-learnings.js` 只写入 `knowledge` 表，但 `learning-retriever.js` 从 `learnings` 表读取。两张表完全独立，导致 100+ 条高质量 learning 规则从未被注入到 /dev 任务上下文中。

### 根本原因

distill-learnings.js 最初设计时只考虑了 knowledge 表，后续增加 learnings 表和 learning-retriever 时没有回溯更新写入端，造成读写断裂。

### 下次预防

- [ ] 新增数据消费者（reader）时，必须检查所有数据生产者（writer）是否覆盖目标表
- [ ] 数据流文档应标注每张表的 writer 和 reader，避免断裂
- [ ] learnings 表的 content_hash 只有普通索引没有唯一约束，使用 WHERE NOT EXISTS 替代 ON CONFLICT 做幂等
