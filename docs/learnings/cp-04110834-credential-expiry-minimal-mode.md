# Learning: credential-expiry-checker MINIMAL_MODE guard 漏洞

**分支**: cp-04110834-929d4868-credential-expiry-minimal-mode-fix
**日期**: 2026-04-11

### 根本原因

PR #2187 新增 MINIMAL_MODE 时，10.x section 和 proactiveTokenCheck 都被 guard 包裹，但 credential-expiry-checker 块（第 1651–1689 行）单独维护在 tick.js 主流程中段，被遗漏。

### 下次预防

- [ ] 新增全局开关（如 MINIMAL_MODE）时，grep 全文所有 `_last*Time` 变量，确保每个定时检查块都被 guard 覆盖
- [ ] MINIMAL_MODE 说明注释应列出所有被跳过的模块，便于后续维护时对照
