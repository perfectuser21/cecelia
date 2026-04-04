# Learning: 重构 contactFieldsToNotionProps — CC 27 → 7

## 根本原因

`contactFieldsToNotionProps` 函数将 10 个 Set 常量定义在函数体内，并用 9 个 else-if 链（含 &&/|| 逻辑运算符）处理字段映射，外加 4 个嵌套 if 的自动检测分支，导致圈复杂度累积到 27（阈值 10 的 170%）。

## 解决方案

1. **常量提升**：将 10 个 Set 提取为模块级 `CONTACT_KEY_SETS` 对象，不再每次调用时重建
2. **分层拆分**：
   - `_contactMapKnownKey` — 5 个精确 key 匹配（CC=6）
   - `_contactMapWithCondition` — 4 个 key+值条件混合（CC=9）
   - `_contactInferFromValue` — 4 个值类型自动检测（CC=9）
   - `_contactMapField` — 组合调用（CC=1，用 `??` 链）
3. **主函数简化**：for 循环 + 3 个 if → CC=7

## 下次预防

- [ ] 函数超过 5 个 else-if 分支时立即考虑 dispatch table 或子函数拆分
- [ ] 模块级常量（Set/Map/配置对象）不要放在函数体内，避免每次调用重建且影响 CC 计算
- [ ] `??` 链（nullish coalescing chain）是优雅的 "try each handler" 模式，适合策略链场景
