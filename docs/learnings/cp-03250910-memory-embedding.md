# Learning: 记忆系统 PR10 — conversation_turn embedding fire-and-forget

Branch: cp-03250910-memory-embedding
Date: 2026-03-25

## 实现内容

在 `orchestrator-chat.js` 两处 `memory_stream` INSERT 后，
fire-and-forget 调用 `generateMemoryStreamEmbeddingAsync`：
- 用户消息插入后（`userRecordId`）
- Cecelia 回复插入后（`replyRecordId`）

`generateMemoryStreamEmbeddingAsync` 已在 `embedding-service.js` 存在，
无 OPENAI_API_KEY 时静默 no-op，失败时只 warn 不阻塞主流程。

## 关键决策

选择 `Promise.resolve().then(...).catch(...)` 而非直接调用，
保持与 tick.js 其他 fire-and-forget 模块一致的写法，
且能捕获同步抛出的异常。

## 根本原因

`orchestrator-chat.js` 之前只调用了 `generateMemoryStreamL1Async`（生成 L1 摘要），
漏掉了 `generateMemoryStreamEmbeddingAsync`（生成向量）。
导致所有对话轮次的 memory_stream 行 embedding = NULL，
向量检索（相似记忆召回）无法命中这些记录。
`embedding-service.js` 已有完整实现，只是从未被 orchestrator-chat.js 引用。

## 下次预防

- [ ] 新增 memory_stream INSERT 时检查清单：L0（generateL0Summary）+ L1（L1Async）+ embedding（EmbeddingAsync）三件套
- [ ] 可考虑封装 `insertMemoryStreamEntry(content, ...)` 统一处理三步，避免遗漏
