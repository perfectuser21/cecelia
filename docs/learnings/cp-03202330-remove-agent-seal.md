# Learning: 删除 agent_seal 旧审查系统残留

## 背景
Pipeline v2 引入 Codex Gate（spec_review + code_review_gate）替代旧的 Subagent 审查，但 agent_seal（Gate 2）残留未删，导致 agent 子进程跑 /dev 时被旧 Gate 拦住。

### 根本原因
Pipeline v2 改造时只替换了审查的"新系统"（Codex Gate），没有删除"旧系统"（agent_seal）。两套系统同时存在，旧的 Gate 2 要求每个 Step 有独立 Subagent 写入 .dev-agent-seal 文件，但新流程不再有 Subagent。

### 下次预防
- [ ] 新系统上线时必须同时删除旧系统的所有残留
- [ ] 用 grep 全仓扫描旧系统的关键词确认无残留
- [ ] Pipeline 改造 PRD 中列出"要删的旧代码"清单
