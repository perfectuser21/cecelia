# Sprint 3 Harness v2.0 强化 — Learning

**分支**: cp-04060600-960b0811-1d10-4af1-927f-9425d1
**日期**: 2026-04-06

### 根本原因

Harness v2.0 的 sprint_contract_review 分支存在 3 个脆弱点：
1. verdict 解析依赖文本正则而非对象字段，可能误判 "部分 APPROVED 但需修改" 类型的回复
2. 协商轮次无上限，双方分歧时可能无限循环
3. Evaluator 和 Reviewer SKILL.md 缺少关键规则说明，导致行为不一致

### 下次预防

- [ ] 凡涉及 verdict 解析的分支，优先检查对象字段（`result.verdict`），再降级到文本正则
- [ ] 所有协商/重试循环必须有安全阀（MAX_XXX_ROUNDS 常量 + console.error 日志）
- [ ] SKILL.md 是运行时角色说明，需包含完整的判定规则（exit code 语义、轮次感知等）
- [ ] DoD 验证命令的 `indexOf` 窗口大小需考虑代码结构，避免找错区块
