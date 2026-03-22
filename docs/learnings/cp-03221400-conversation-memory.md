# Learning - 对话记忆闭环：空闲超时总结 + 主动写记忆

**Branch**: cp-03221400-conversation-memory
**PR**: #1389

### 核心洞察

Cecelia 的记忆系统有7层（emotion/self_model/reflection/desire/episodic/semantic/person_model），但之前只对**单条消息**做 extractConversationLearning（一问一答粒度）。整段对话的核心结论、决策没有被整体压缩存入记忆。

两个互补机制：
1. **空闲超时总结**（被动）：30分钟无新消息 → 取窗口内全部对话 → LLM 压缩 → memory_stream + learnings
2. **主动写记忆**（主动）：Cecelia 自己感知"这件事我想记住" → save_memory thalamus signal → 立即写入

### 架构决策

- conversation_summary 的 expires_at = 90天（importance=7，按分级 >=5→90天）
- save_memory importance 分级：>=8 永不过期，>=5 +90天，<5 +30天
- 防重复用 working_memory key='last_conversation_summary_at' 而非记录数量

### 下次预防

- [ ] 新增 thalamus signal 类型时，同时更新 orchestrator-chat.js 的 system prompt 说明
- [ ] setInterval 定时任务要 fire-safe（try/catch 不阻断主进程），与 evolution-scanner 模式一致
