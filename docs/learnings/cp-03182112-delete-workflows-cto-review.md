# Learning: 删除 packages/workflows/skills/cto-review/

**Branch**: cp-03182112-delete-workflows-cto-review
**Date**: 2026-03-18
**Type**: chore（清理误放文件）

---

### 根本原因

在 PR #1087（feat(engine): 添加 cto-review skill）合并时，该 skill 被错误地放到了两个位置：
- `packages/engine/skills/cto-review/`（正确位置）
- `packages/workflows/skills/cto-review/`（错误位置）

根本原因：开发时在 workflows 目录下也创建了 SKILL.md，未在合并前清理。

---

### 下次预防

- [ ] 新增 skill 时明确只放 `packages/engine/skills/`，不放 `packages/workflows/skills/`（workflows 是 N8N 工作流，不是 skill 定义）
- [ ] PR review 阶段检查 skill 目录只在 engine 下，不在 workflows 下
- [ ] 理解边界：packages/engine = DevGate/hooks/skills，packages/workflows = Agent 协议/N8N 配置

---

### 总结

简单清理任务，删除一个 1 文件目录。主要的额外工作来自：
1. CI 要求 DoD 必须含 [BEHAVIOR] 条目（即使是纯清理任务）
2. Learning 文件是必须的
3. verify-step.sh Gate 在 worktree 模式下的 git 上下文问题（从主仓库 hooks 目录运行）
