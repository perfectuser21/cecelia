# Learning: PR4 记忆系统 — Rumination 质量改进

**分支**: cp-03242132-memory-rumination-quality
**日期**: 2026-03-24

## 做了什么

在 `rumination.js` 中扩展了 Rumination 的输入源和上下文质量：
- 新增 `fetchMemoryStreamItems(db, limit)` — 读取 memory_stream 高显著性对话条目（salience_score ≥ 0.7，source_type='conversation_turn'，status='active'）
- runRumination：learnings 不足时自动补充 memory_stream 条目，形成"对话 → 记忆 → 反刍"闭环
- buildNotebookQuery：当条目含 emotion_tag 时，将情绪上下文注入 NotebookLM 查询
- 消化完成后将已处理 memory_stream 条目 status 更新为 'ruminated'，避免重复处理

## 根本原因

Rumination v3 引入 NotebookLM 主路后，输入源仍只有 `learnings` 表 FIFO，未利用 PR2 写入的高显著性对话记录（memory_stream）。
这导致反刍内容与真实对话脱节——Cecelia 做深度思考时看不到最近的重要对话，即使这些对话已有 salience_score 和 emotion_tag。
此外 buildNotebookQuery 生成的查询不含情绪上下文，NotebookLM 无法感知对话时的情绪状态，洞察质量受限。

## 下次预防

- [ ] 扩展 Rumination 输入时，同步检查 digestLearnings 是否能处理新格式（title 为 null 时用 content 替代）
- [ ] fetchMemoryStreamItems 返回条目需显式标记 source='memory_stream'，便于 digestLearnings 区分来源
- [ ] 标记 'ruminated' 的 UPDATE 要用 uuid[] 类型参数：`$1::uuid[]`，否则 PostgreSQL 类型推断失败
