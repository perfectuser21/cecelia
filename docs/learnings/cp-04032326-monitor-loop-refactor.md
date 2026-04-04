## 重构 gatherFailureContext（2026-04-04）

### 根本原因
`gatherFailureContext` 将 3 种不同数据源（task元数据、run payload、相似失败统计）的 DB 查询全部内联在一个函数体内，加上 try/catch 包裹和多层 `if` 嵌套，导致圈复杂度达到 25。

### 下次预防
- [ ] 新增 DB 查询函数时，每个函数只负责一种数据源（Single Responsibility）
- [ ] 函数超过 40 行时提前考虑拆分，不等扫描报警
- [ ] 使用早返回（early return）替代嵌套 if，`if (!x) return null` 优于 `if (x) { ... }`
