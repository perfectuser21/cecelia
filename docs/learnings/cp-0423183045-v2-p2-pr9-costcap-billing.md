## v2 P2 PR9 cost-cap + billing Middleware（2026-04-23）

### 根本原因

v2 P2 第 9 PR，建立外层最后两个 middleware。cost-cap 通过 throw 阻止超预算 spawn（CostCapExceededError 自定义错误类，便于上层 catch 做特殊处理）。billing 异步写 tasks.payload 做归账——和 executor.js:3083 的当前逻辑功能等价，未来接线时替代它。

两个都用 deps 注入模式，单测 10 cases。和前 8 个 middleware 一致的设计模式，reviewer 不用每次重新验证 architectural fit。

### 下次预防

- [ ] **CostCapExceededError 是有意义的自定义错误类**：不是用 plain Error。spawn() 上层 catch 时可以按 `err.name === 'CostCapExceededError'` 或 `instanceof CostCapExceededError` 区分预算拒绝 vs 其它失败，做不同 task 状态处理（前者是"超预算"非"故障"）
- [ ] **billing 容错优雅降级**：DB 写入失败不阻止 spawn 返回结果，只 warn log。因为 billing 是观测用，不能让"记不上账"导致"任务失败"
- [ ] **外层 middleware 全部都不接线**：PR8 + PR9 共 4 个外层 middleware 全部是模块 + 测试。等 PR10/11 之前/之后的 attempt-loop 整合 PR 一次性 wire up
