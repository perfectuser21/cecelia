# Learning: conversation-digest — Brain 自动读取 Claude Code 对话日志

**分支**: cp-03250222-91e5b746-3bd8-41d8-9522-7234db
**日期**: 2026-03-25
**任务**: feat(brain) conversation-digest

## 根本原因

用户与 Claude Code 的规划对话日志以 .jsonl 格式存在本地磁盘，Brain 无法感知这些对话内容，导致跨对话的决策和想法全部丢失。根本原因：缺少轮询机制和游标系统来追踪已处理的对话行。

## 解决方案

1. 新增 `conversation_log_cursors` 表做游标追踪（file_path UNIQUE + last_line_processed + digest_status）
2. 新增 `conversation-digest.js` 模块，实现：
   - 多账号目录扫描（.claude-account1/2/3 + .claude）
   - 逐行增量读取（避免重复处理）
   - 触发阈值判断（≥8条 human 或最后消息 ≥30分钟）
   - LLM 提炼 5 维度（decisions/ideas/open_questions/tensions/summary）
   - 并发保护（`_running` 标志防止重叠执行）
3. 扩展 `conversation_captures` 表：新增 ideas/open_questions/tensions/source_file/digest_method 列
4. `tick.js` fire-and-forget 集成（不阻塞主 tick）

## 下次预防

- [ ] 新增 Brain 模块前，先检查 `conversation_captures` 等相关表是否已存在（migration 194 已创建该表，需要 ALTER TABLE 扩展而非重建）
- [ ] `DEFINITION.md` 的 `schema_version` 字段必须与 `selfcheck.js` 同步更新，否则 push 前 precheck 会失败
- [ ] Learning 文件必须在第一次 push 前写好，否则 L1 Process Gate (Stage 4) 会失败
- [ ] 并发模块需要 `_running` 标志防重叠，特别是涉及文件 I/O 的扫描操作
