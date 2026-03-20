# Learning: /dev Robust 改造 — 假 subagent 清理

### 根本原因
02-code.md 中所有 subagent（Test Designer/Verifier/Cleanup/内部 Reviewer）都是 prompt 模板，
AI 可以跳过任何一个而系统无法检测。实际上这些 subagent 从来没被真正执行过。
同时 03-prci.md 注册审查任务后不调 dispatch-now，导致 Codex 审查依赖调度器（默认关闭）而无法执行。

### 下次预防
- [ ] 新增的流程步骤必须有技术强制（Hook/CI），不能只靠 prompt
- [ ] 设计 subagent 前先确认 Agent() 工具能否被强制调用
- [ ] 依赖外部服务的功能必须有降级路径说明
