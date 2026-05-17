# Learning: 重构 formatItem — 圈复杂度 21 → 5

## 根本原因

`formatItem` 函数复杂度 21 的来源：
- `||` 链每个运算符算 +1（`item.description || item.text || ''` = +2）
- `&&` 链：`!== undefined && !== null` = +2（可用 `!= null` 合并为 +1）
- depth 判断 3 个分支 + 内部重复的 extras 构建逻辑（相同代码出现两次）

## 修复方案

提取两个辅助函数：
- `_buildExtras(item)` — 构建关联信息数组（`!= null` 代替 `!== undefined && !== null`）
- `_getPreviewBase(item, depth)` — 按 depth 选文本来源

主函数 `formatItem` 降至 5 个分支（1基础 + `||` + `||` + 三元 + 三元）。

## 下次预防

- [ ] 复杂度扫描报告中看到 `||` 链多于 2 个，优先提取辅助函数
- [ ] `!== undefined && !== null` 可直接改 `!= null`（JavaScript 宽松比较会同时排除 undefined 和 null）
- [ ] 相同代码块出现 2 次以上必须提取函数
