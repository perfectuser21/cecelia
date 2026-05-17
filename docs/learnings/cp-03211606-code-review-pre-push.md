# Learning: code_review_gate 前移到 Stage 2

Branch: cp-03211606-code-review-pre-push
Date: 2026-03-21

## 变更内容

code_review_gate 从 Stage 3（CI 后）前移到 Stage 2（push 前），实现审查前置。

### 根本原因

原流程 code_review 在 CI 通过后才执行，导致：
1. CI 通过后还要等 Codex 审查，增加等待时间
2. 审查发现问题需要重新 push + 重跑 CI，浪费 CI 资源
3. 流程不对称：spec_review 在 Stage 1 后做（push 前），code_review 却在 push 后做

### 下次预防

- [ ] 新增 Gate 节点时，优先考虑放在 push 前（本地阶段），减少远端往返
- [ ] devloop-check.sh 条件顺序变更时，同步更新顶部注释和 SKILL.md 流程图
- [ ] feature-registry.yml 必须与 skills/hooks 改动同步（Impact Check 会强制检查）
