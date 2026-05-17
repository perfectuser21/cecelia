# Learning: conversation-digest — Brain 自动读取 Claude Code 对话日志

**分支**: cp-03251722-conversation-digest
**日期**: 2026-03-25

## 背景

用户与 Claude Code 的 before-coding 规划对话（decisions/ideas/open_questions）目前完全丢失。
提示词注入方案（让 AI 记录）被证明不可靠——上下文长时 LLM 会遗忘。

## 核心洞察

Claude Code 会机械地将对话日志写入 `~/.claude-account1/projects/{slug}/*.jsonl`，这是可靠的 artifact。
Brain 作为同机服务，可以直接读取这些文件，绕过 LLM 注意力依赖。
这是"结构性保证"而非"提示词依赖"。

## 实现要点

- `conversation_log_cursors` 表用 `file_path UNIQUE` 做幂等 cursor 追踪
- 阈值设计：≥8条 human 消息 OR 最后消息 >30分钟前（防止只有几条问答的短对话被误分析）
- 每次最多处理 3 个文件（MAX_PER_RUN），避免占用过多 tick 时间
- Cortex 分析用 `callCortexLLM` 已有抽象，不需要新建 LLM 调用路径
- fire-and-forget 模式（同 diary-scheduler.js），tick 不阻塞

## 根本原因

### 根本原因

可靠的知识捕获需要依赖机械写入的 artifact，而非依赖 LLM 注意力。
Claude Code 的 `.jsonl` 日志恰好是这样的 artifact，且 Brain 在同机可直接访问。
提示词注入（让 AI 自己记录）在上下文变长时会失效；结构性 cursor 追踪不依赖 LLM 注意力。

### 下次预防

- [ ] 新增知识捕获模块时，优先考虑"机械写入的 artifact"而非"提示词注入"
- [ ] `conversation_log_cursors.digest_status` CHECK 约束限制了状态值，避免状态污染
- [ ] 分析结果通过 `persistDigest` 写入 `decisions` 表，与现有知识体系集成

## 文件变更

- `packages/brain/migrations/196_conversation_log_cursors.sql` — 新建进度追踪表
- `packages/brain/src/conversation-digest.js` — 新建核心模块（scan/analyze/persist）
- `packages/brain/src/tick.js` — 集成 runConversationDigest（10.3 节点）
- `packages/brain/src/selfcheck.js` — EXPECTED_SCHEMA_VERSION → '196'
- `DEFINITION.md` — Schema 版本: 196
- `tests/conversation-digest-tick.test.js` — BEHAVIOR 测试
