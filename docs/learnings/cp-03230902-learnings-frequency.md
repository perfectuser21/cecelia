# Learning — learnings 频率强化机制：为什么重复写入不等于重复记忆

**Branch**: cp-03230902-learnings-frequency
**PR**: #1405

### 根本原因

learnings 表已有 `frequency_count` 和 `content_hash` 字段，但从未被使用：
- 3 处写入路径（thalamus/orchestrator-chat/quarantine）直接 INSERT，无任何去重
- `frequency_count` 全部 NULL，"重复次数"信号完全丢失
- backfill 每小时只处理 10 条，551 条积压理论上需要 55 小时才能清空

根因不在设计，而在**执行断层**：字段已定义，但写入路径没有配套跟进。

### 频率强化的正确模式

重复发现同一教训不应创建新行，而应：
```
UPDATE learnings SET frequency_count += 1, last_reinforced_at = NOW() WHERE title = $1
```

这样 `frequency_count` 成为"这个教训被强化了多少次"的信号，检索时可作为权重因子。

### 下次预防

- [ ] 任何新增 learnings 写入路径，必须调用 `upsertLearning()` 而非直接 INSERT；代码审查时重点检查裸 INSERT INTO learnings
- [ ] backfill 类函数默认应为"全量处理到清零"模式，不要默认单批次——单批次需要用注释明确说明原因
- [ ] Migration 中 UPDATE + DELETE 两步操作的 keep 逻辑必须使用同一排序规则；推荐用 CTE 显式定义 keep_id 后复用
