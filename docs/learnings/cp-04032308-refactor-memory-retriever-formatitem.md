# Learning: memory-retriever.formatItem 重构

### 根本原因

formatItem 函数中重复的 `||` 链、内联的对象字面量和两次相同的 extras 构建逻辑（depth 1 和 depth >= 2 各一份）导致圈复杂度达到 21。主要来源：
- 每个 `||` 和 `&&` 各计 +1 复杂度
- sourceLabel 对象放在函数内部（无害但加长了函数体）
- depth 1 和 depth >= 2 的 extras 逻辑完全重复

### 下次预防

- [ ] 复杂度来源：`||` / `&&` / ternary 每个都贡献 +1，不只是 if/else
- [ ] 相同逻辑出现 2 次以上 → 立即提取子函数（_buildItemExtras 等）
- [ ] 模块级常量（SOURCE_LABELS）不要放进函数体
- [ ] 子函数命名加 `_` 前缀标识内部 helper（_getItemText、_buildPreview 等）
