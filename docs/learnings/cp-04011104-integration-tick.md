# Learning: Tick Loop 诊断集成测试

### 根本原因
Tick loop 的跨模块行为（tick → executor dispatch → task状态）从未被集成测试验证。
单元测试全部 mock executor，导致两者的接口契约从未被真实验证。

关键发现（代码分析阶段）：
- `runTickSafe('manual')` 不受 TICK_INTERVAL_MINUTES 节流限制（仅 'loop' source 受限）
- executor 不可用时 tick 会把任务从 in_progress 回退到 queued（tick.js:1139）
- `cecelia_events` 表记录 dispatch 事件，但仅在实际 dispatch 发生时写入

### 发现（运行后填写）

- [ ] 手动触发 tick 后，queued 任务能否变为 in_progress？
- [ ] tick 是否幂等？（连续两次触发同一任务不会被重复 dispatch）
- [ ] executor dispatch 失败时 task 状态如何？（预期回退到 queued）
- [ ] cecelia_events 是否记录了 tick 执行痕迹？

### 下次预防

- [ ] tick loop 修改后必须手动运行此诊断测试
- [ ] 发现 bug 时在测试文件中加 `// DIAGNOSTIC` 注释记录
- [ ] 新增 executor 接口时同步更新集成测试的状态流转验证
