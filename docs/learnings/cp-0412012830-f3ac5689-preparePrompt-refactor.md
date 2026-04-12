## executor.preparePrompt 圈复杂度重构 24→5（2026-04-12）

### 根本原因
`preparePrompt` 长期积累内联条件分支和路由 lambda，圈复杂度升至 24（历史扫描值 77）。核心问题是：多个早返回条件（special case）混杂在主函数体中，加上 6 个路由表内联箭头函数无命名，导致认知负担极高。

### 下次预防
- [ ] 路由表中的 lambda 超过 3 行即提取为命名函数，不允许内联复杂逻辑
- [ ] 新增 task_type 路由时，在对应命名函数中实现，不在路由表内联
- [ ] preparePrompt 圈复杂度门槛：< 10，CI 扫描时触发告警
- [ ] special case 早返回逻辑统一收归 `_resolveSpecialCasePrompt`，不散落在主函数
