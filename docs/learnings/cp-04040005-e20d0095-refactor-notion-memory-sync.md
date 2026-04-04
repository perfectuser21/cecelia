---
branch: cp-04040005-e20d0095-dc91-4767-9c4e-c3f44b
date: 2026-04-04
task: 重构 contactFieldsToNotionProps 圈复杂度 27 → 10
---

# Learning: 提取子函数降低圈复杂度

### 根本原因
`contactFieldsToNotionProps` 函数内有 10 组 `if-else` 分支 + 内嵌 else 块（4 分支），加上 `||`/`&&` 布尔运算符共贡献 27 的圈复杂度。

### 解决方案
- 将 10 个 key Set 常量从函数内移到模块级（避免每次调用重建）
- 提取 `_fieldPropByKey(key, val)` — 处理已知 key 的分支（9 个 if，函数内复杂度 ~14）
- 提取 `_autoDetectByValue(val, props)` — 处理未知 key 的值类型检测（4 个 if）
- 主函数简化为 7 行：for 循环 + 两次 `if` = 复杂度 6

### 关键决策
- `_fieldPropByKey` 保留了原始的 `EMAIL_KEYS.has(key) || isEmailStr(val)` 和 `URL_KEYS.has(key) || isUrlStr(val)` 逻辑，行为完全兼容
- `_autoDetectByValue` 仅在 `_fieldPropByKey` 返回 null 时调用（对应原来的 else 块）

### 下次预防
- [ ] 函数内包含 `>3` 层 if-else 时考虑提取子函数或 dispatch table
- [ ] 模块级常量比函数内常量更高效（避免每次调用重建 Set）
- [ ] worktree 中没有 node_modules，需要 `ln -sf /主仓库/node_modules ./node_modules` 才能运行测试
