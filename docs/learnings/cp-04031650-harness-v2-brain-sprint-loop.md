### [2026-04-03] Harness v2.0 Sprint Generate→Evaluate→Fix 循环断链

**CI 失败次数**: 0
**本地测试失败次数**: 1（测试 mock 不够精确，simulateHarnessCallback 中的 pool.query mock 对不上实际调用参数）

### 根本原因

初版测试用 `expect.stringContaining()` 作为 mock 的参数匹配，运行时不生效。改为精确的函数调用 + 顺序 `mockResolvedValueOnce` 后通过。

### 下次预防

- [ ] 测试 mock 用精确参数，不用 `expect.*` matcher 做运行时匹配
- [ ] execution-callback 断链改动时，先确认旧断链的 SELECT 语句是否需要新增字段（本次需加 payload 字段到 5c9 的 SELECT）
- [ ] 新旧兼容策略（payload.harness_mode）是正确的做法，避免大规模重构
