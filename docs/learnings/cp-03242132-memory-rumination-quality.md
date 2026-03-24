# Learning - 记忆系统 PR4：Rumination 消化 memory_stream 高显著性条目

**Branch**: cp-03242132-memory-rumination-quality
**PR**: (待合并)
**Brain Task**: f6062d6e-f08c-4298-b1c5-57500edc5fd0

### 根本原因

Rumination 仅从 `learnings` 表 FIFO 取输入，忽略了 PR2 已写入的高显著性对话记录（`memory_stream`，salience_score ≥ 0.7）。导致"对话 → 记忆 → 反刍 → 洞察"闭环断裂：反刍时没有消化最近的重要对话内容。

### 修复方案

1. 新增 `fetchMemoryStreamItems(db, limit)` — 读取 salience_score ≥ 0.7 的 conversation_turn 条目
2. `runRumination` 在 learnings 不足（< limit）时，补充 memory_stream 条目
3. `buildNotebookQuery` 已支持 emotion_tag 上下文（代码已有，PR4 通过 items 传入激活）
4. 消化完成后，已处理的 memory_stream 条目 status 更新为 'ruminated'

### 下次预防

- [ ] 新引入 memory_stream 写入逻辑时，同步评估"反刍是否能读取并消化这些数据"
- [ ] 多数据源合并时，用 `allItems = [...sourceA, ...sourceB]` 模式，保持 digestLearnings 单入口
- [ ] status 字段生命周期（active → ruminated）需在设计时就在 PRD 中明确，避免遗漏更新步骤
