# Learning: Bridge claude CLI 路径
## 分支
`cp-03200730-fix-claude-path`
### 根本原因
Bridge 硬编码 `/Users/administrator/.local/bin/claude`，但实际路径是 `/opt/homebrew/bin/claude`。半夜所有 LLM 调用 ENOENT → rumination/reflection/memory 全挂 → scheduler 被关。
### 下次预防
- [ ] 外部命令路径不硬编码，用环境变量 + 合理默认值
- [ ] Bridge LLM 调用失败应有降级策略，不应导致 scheduler 关闭
