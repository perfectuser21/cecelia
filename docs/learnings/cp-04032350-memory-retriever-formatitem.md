# Learning: 重构 memory-retriever.formatItem（复杂度 21 → ≤10）

**任务 ID**: 37f18a82-a574-4823-bb9b-cbac0a386648
**日期**: 2026-04-04

### 根本原因

`formatItem` 函数在 depth=1 和 depth=2 两个分支中存在完全相同的 `extras` 构建逻辑（共 4 行代码重复），加上多层 `||` 运算符使得圈复杂度达到 21（工具计入逻辑运算符）。

### 解决方案

提取三个单职责子函数：
- `buildExtras(item)` — 构建关联数组（task_count + parent_kr_title）
- `appendExtras(base, extras)` — 附加 extras 到文本
- `getPreview(item, depth)` — 根据 depth 生成预览文本

`formatItem` 本身降到 3 行核心逻辑，复杂度降至 3。

### 下次预防

- [ ] 函数中出现相同逻辑块第二次时，立即提取为命名函数（DRY 原则）
- [ ] `||` 链超过 2 个操作数时，考虑提取为独立变量或函数
- [ ] 复杂度扫描阈值 10；每次改动复杂函数时先测量再提交
