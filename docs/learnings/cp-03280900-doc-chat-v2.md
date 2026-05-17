# Learning: DocChatPage v2 — 对话持久化 + 文件选择 + Analyze Capture

## 根本原因

DocChatPage 缺少对话持久化、文件切换和分析提取能力，导致用户每次刷新都丢失对话上下文，
无法在文档间切换，也无法把讨论内容转化为可追踪的 Brain captures。
核心缺口在于 design_docs 表没有 chat_history 字段，Brain 没有 /analyze 端点，前端也没有 FileSelector 组件。

## 解决方案

- 增加 migration 202：`chat_history jsonb DEFAULT '[]'` + `analyze_watermark integer DEFAULT 0`
- Brain `POST /:id/analyze`：增量（从 watermark 截取）+ 语义去重（查已有 `source=doc-chat:{id}` captures）
- DocChatPage：FileSelector 下拉 + 持久化历史（100 条上限）+ Analyze 按钮 + 纯文本聊天渲染

## 下次预防

- [ ] 新增对话类页面时，默认评估是否需要跨会话持久化；如需要，立即规划 DB 字段
- [ ] Analyze / 提取功能应使用 `source` 字段做去重基准，避免重复 capture
- [ ] 前端 feat PR 必须同步更新 `__tests__` 文件，否则 L3 CI 阻止合并
