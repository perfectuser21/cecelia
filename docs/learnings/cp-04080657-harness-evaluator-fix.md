# Learning: Harness v4.1 — 修复 contract 对抗链与机械执行器

**Branch**: cp-04080657-b7a4ec66-54b6-4c69-b6fa-4e14b7  
**Date**: 2026-04-08

---

### 根本原因

`packages/workflows/skills/harness-*` 在 v4.0.0 改名时，同步引入了三处设计退化：

1. **harness-contract-proposer**：合同格式只保留"行为描述+硬阈值"，移除了验证命令代码块。GAN 对抗的核心（Evaluator 挑战命令严格性）因此失去了对象。

2. **harness-contract-reviewer**：审查维度从"验证命令是否严格"改为"行为描述是否清晰/无歧义"。这让 GAN 对抗变成了文字审查，无法保证命令质量。

3. **harness-evaluator**：改为"读 PR diff 静态验证"并"禁止调 localhost API"。虽然 localhost 测旧代码这个 P0 顾虑真实存在，但官方设计要求 Evaluator 是机械执行器——合同里的验证命令本身就是在 PR 合并后的环境中执行的。静态 diff 分析无法替代真实命令执行。

### 下次预防

- [ ] 改名/重构 harness skill 时，逐一对照官方论文 SSOT（`memory/harness-v3-design.md`）确认三要素不变：合同有验证命令 + Reviewer 挑战命令严格性 + Evaluator 机械执行命令
- [ ] skill changelog 写"改了什么"时，同步检查是否破坏了这三要素
- [ ] harness-evaluator 的"禁止 localhost"顾虑正确，但解法不是静态分析——应在 PR 合并后 deploy 再跑 Evaluator，或在 Generator 的 PR 分支环境中跑（合同命令面向已部署环境设计）
