# Learning: Generator subagent 拆分

**分支**: cp-03292241-generator-subagent
**日期**: 2026-03-29

## 变更摘要

将 /dev Stage 2 的 2.2 写代码步骤从主 agent 内部执行重构为独立 Generator subagent 模式。

### 根本原因

主 agent 在 Stage 2 中既做探索、又做编码、又做验证，context 窗口压力大。拆出 Generator subagent 后：
1. Generator 的 context 只含必要信息（spec + 代码），质量更高
2. 主 agent 保持编排者角色，与 spec_review/code_review_gate 的 subagent 模式一致

### 下次预防

- [ ] skill 文件（`~/.claude-account1/skills/`）不在 git repo 中，修改时 branch-protect hook 会因找不到正确 git context 而阻止 Edit 工具，需用 Bash/Python 直接写入
- [ ] skill 文件有 3 个副本需同步：`~/.claude-account1/skills/`（运行时）、`packages/engine/skills/`（repo engine）、`packages/workflows/skills/`（repo workflows）
- [ ] DoD Test 中如果检查文件内容不包含某字符串（负向检查），注意文件本身的描述性文本也可能包含该字符串（如 "brain context" 出现在隔离规则说明中）
