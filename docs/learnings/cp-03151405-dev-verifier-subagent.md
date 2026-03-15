## [2026-03-15] /dev Verifier Subagent 状态机模式

**失败统计**：CI 失败 0 次，本地测试失败 0 次

### 根本原因

本次无失败。核心发现：

1. **PRD Scope Check 是 0.3 问题的帮凶**：原设计的"Task Card = 唯一权威，其他文档只是背景"意图防止 scope 漂移，但副作用是锁死了薄 Task Card，探索阶段的发现无法反哺 DoD。修复：在 Scope Check 之前加 DoD 深度挑战，允许探索发现扩充 DoD（是校准理解，不是扩展 scope）。

2. **Subagent 隔离性是状态机模式的基础**：Subagent 完全独立 context，不能修改主 agent 变量，只能返回文本。因此 Verifier Subagent 是天然的无偏 gate——它不知道主 agent"希望"结果是什么，只能客观运行测试。

3. **bash 检查格式，LLM 检查质量，分工不重叠**：不需要 LLM 重复检查 bash 已经验证过的事；也不应该用 bash 判断语义质量。Task Card 和 Learning 的质量问题是语义问题，LLM gate 比 bash 更适合。

### 下次预防

- [ ] 改 /dev 步骤文件时，先检查现有自检逻辑是否与新改动冲突（Scope Check vs DoD Depth Challenge）
- [ ] Verifier Subagent prompt 末尾必须显式说明"不要写入 .dev-mode"，保护 Stop Hook 机制
- [ ] bash 自检通过后才触发 LLM gate，避免在格式都错误时浪费 LLM 调用

**影响程度**: Low（流程顺畅，无失败）
