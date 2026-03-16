---
branch: cp-03161411-brain-memory-search
pr: "https://github.com/perfectuser21/cecelia/pull/979"
date: 2026-03-16
---

# Learning: Brain memory-search 端点

## 根本原因

Claude Code 对话存在上下文盲点——Cecelia 大脑 memory_stream 有 7847 条记录含 embedding，但无专用查询接口。现有 `/search-similar` 搜索 tasks 表，不是 memory_stream。

## 解决方案

新增 `POST /api/brain/memory-search`，复用现有 `generateEmbedding`（openai-client.js）+ pgvector `<=>` 运算符，约 50 行代码接通两个系统。

## 下次预防

- [ ] 新增 Brain 端点时优先复用现有 embedding/pgvector 基础设施，不要重建
- [ ] Claude Code 对话开始时可调用此端点检索相关记忆，减少上下文盲点
- [ ] limit 上限设 20 防止返回过多数据塞满 context
