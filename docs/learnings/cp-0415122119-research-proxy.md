## Autonomous Research Proxy Layer (2026-04-15)

### 根本原因
Superpowers 14 个 skill 有若干 user 交互点，autonomous_mode 下每次碰到就断链。之前尝试用 subagent-as-approver 被 CTO 批评是"同一 LLM 自审"。正确方向是:subagent 不是审批者而是**调研员**，用外部锚点(code/OKR/history)得出真实答案，不是 AI 互相盖章。

### 今晚 POC 验证
任务"给 .gitignore 加 .bak" → brainstorming 问 clarifying → 主 agent 派 haiku Subagent → 27s 完成 grep + find + git log + 脚本分析 → 高置信度答案 + 发现原 PRD 冗余（root .gitignore:37 已覆盖）。Subagent 比 user 凭印象更准。

### 下次预防
- [ ] 任何"AI 给自己加约束"的 PR 都应先审查"是不是把 user 用 AI 简单替换"。subagent 作为独立调研员(有外部锚点)可行，作为审批者(无外部锚点，同 LLM 自审)不可行。
- [ ] POC 先行 — 小任务验证模式 30 分钟，避免 8 小时大 PR 做完才发现方向错
- [ ] 给 AI 加上下文(OKR + code + history) > 给 AI 加约束(approval gates)。前者赋能，后者防御，效果相反。
