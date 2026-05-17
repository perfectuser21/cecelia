# Learning: 重构 _handleChatInner（CC 41 → ≤ 10）

**Branch**: cp-04040105-2c2a11d5-e2fa-4779-a463-8eb386
**Date**: 2026-04-04

### 根本原因

`_handleChatInner` 将 11 个独立职责（标记在线、写 memory_stream、读 emotion_tag、LLM 调用、工具循环、丘脑信号、写回复、异步副作用×8）全部内联在单个函数中，导致圈复杂度达 41。

### 重构策略

按职责边界拆分为 6 个子函数：

| 子函数 | 职责 |
|--------|------|
| `_updateUserPresence` | 更新 user_last_seen / last_alex_chat_at |
| `_readEmotionTag` | 读取 emotion_state（non-fatal） |
| `_writeUserMessageToStream` | 写用户消息到 memory_stream |
| `_callLLMWithToolUse` | LLM 调用 + call_brain_api 工具循环 |
| `_writeReplyToStreamAsync` | 异步写回复到 memory_stream |
| `_fireAsyncSideEffects` | 触发所有对话后副作用（sections 6-11） |

主函数 `_handleChatInner` 从 186 行缩减为 35 行，圈复杂度降至约 4。

### 下次预防

- [ ] 新增 Brain 函数时，若包含 ≥ 3 个独立 try/catch 块 → 立即拆分
- [ ] 异步副作用（fire-and-forget）统一收入 `_fireAsync*` 命名的函数，不在主路径内联
- [ ] `while + try/catch` 工具循环模式 → 提取为独立函数（每个 while 是 +2 CC）
