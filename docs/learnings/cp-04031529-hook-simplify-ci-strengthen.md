## Hook 精简 — 删 verify-step 状态机（2026-04-03）

### 根本原因
verify-step.sh 作为 PreToolUse hook 只有 ~60% 可靠性（AI 可以不写 .dev-mode 直接跳过），但增加大量开发摩擦（PRESERVE/TDD/Gate 多次阻断正常工作流）。Anthropic 官方推荐 Hook 只做安全兜底，验证逻辑放 CI。

### 下次预防
- [ ] 设计新 hook 时先问：这个检查能在 CI 里做吗？能就不放 hook
- [ ] Hook 的职责边界：安全（凭据/分支保护）+ 闭环（stop hook）。不做质量验证
- [ ] DoD 验证命令中避免用字符串 grep 检测注释中的关键词（注释也会命中）
