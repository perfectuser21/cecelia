# Learning: 记忆系统修复 — 对话写入 memory_stream

Branch: cp-03241902-memory-conversation-write
Date: 2026-03-24

## 根本原因

Cecelia 的 memory-retriever 从 `cecelia_events`（无 embedding）读取对话历史，
导致对话记录无法参与语义检索，只能按时间顺序读取最近 N 条。

同时，`memory_stream` 写入对话时：
1. 无 `salience_score`：所有对话等权重，无法区分纠正/决策类高 RPE 事件
2. 无 `emotion_tag`：情绪状态未与记忆绑定
3. source_type='orchestrator_chat'：语义不清晰，与事件总线的 source 混淆

## 修复内容

1. **DB migration 186**：memory_stream 新增 `salience_score FLOAT` + `emotion_tag TEXT` + conversation_turn 索引
2. **computeSalience()**：纠正→0.9 / 决策→0.8 / 疑问→0.6 / 普通→0.3，基于 RPE 原理
3. **orchestrator-chat.js**：两处 INSERT 改用 source_type='conversation_turn'，写入 salience_score 和 emotion_tag
4. **memory-retriever.js**：loadConversationHistory 主路径改用 memory_stream，空时 fallback cecelia_events

## 下次预防

- [ ] 新增 memory_stream source_type 时，同步在 memory-retriever 注册检索路径
- [ ] 每条 memory_stream 写入应携带显著性评分，避免均等权重
- [ ] 测试文件中硬编码 EXPECTED_SCHEMA_VERSION 会随迁移升级而失败，考虑改为读取实际值比较

## 关键洞察

- 情节记忆（memory_stream）和事件总线（cecelia_events）职责分离：
  事件总线是操作日志（无 embedding），记忆流是可检索的经历（有 embedding）
- salience_score 是记忆巩固优先级的关键机制（对应神经科学 RPE 概念）
- 情绪标签（emotion_tag）与记忆强度正相关，高情绪唤醒事件应优先巩固
