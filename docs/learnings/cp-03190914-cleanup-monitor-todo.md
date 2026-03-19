# Learning: 清理 monitor-loop.js TODO 结构债

**分支**: cp-03190914-cleanup-monitor-todo
**日期**: 2026-03-19

### 根本原因

monitor-loop.js 在 P0/P1 快速迭代阶段留下了 6 个 TODO 占位注释，部分功能已在其他模块实现（如 resource-monitor.js 的 throttle 检测），但 monitor-loop 内部未对接。另一些功能（策略执行引擎、probation 创建）确实需要大量设计工作，不适合在清理任务中实现。

### 下次预防

- [ ] 写 TODO 时同时创建 Brain task，设置 deadline
- [ ] 简单功能（<20行）在当次 PR 中直接实现，不留 TODO
- [ ] 复杂功能用 FIXME-TRACKED 格式标记，包含独立 dev task 引用
- [ ] 定期扫描 FIXME-TRACKED 注释，确保有对应的 task 追踪
