# Learning: 重构 executor.preparePrompt 圈复杂度

**分支**: cp-0412012830-f3ac5689-522a-4b8c-86b5-a5a97a
**日期**: 2026-04-12

### 根本原因

`preparePrompt` 复杂度高的根源有两层：
1. 顶部有 3 个早返回 `if` 块，每个含 `||` 或 `&&`（贡献约 7 分支）
2. 路由表的内联 lambda 中直接写 `t.description || t.title`、`t.project_id || t.payload?.initiative_id || ''` 等复合表达式（贡献约 11+ 个 `||`）

扫描器统计的是整个函数体内所有 `if/||/&&/?:` 的总数，包括内联 lambda 里的操作符。

### 下次预防

- [ ] 路由表的 lambda 不要写内联复合表达式（多个 `||`），应提取为命名函数
- [ ] 早返回条件组（3+ 个同类型判断）统一提取到 `_resolveXxx` 辅助函数
- [ ] 新增路由项时，若 lambda 体含 `||`，直接写命名函数放到路由表

### 方案摘要

提取 6 个路由表子函数 + 1 个 `_resolveSpecialCasePrompt` 早返回汇总函数：
- `preparePrompt` 复杂度：24 → **5**
- `_resolveSpecialCasePrompt` 复杂度：**8**（在阈值内）
- 新增 6 个子函数复杂度：2-5（均在阈值内）
- 测试：224 passed
