### 根本原因

WS3 实现内存调度 + 三池隔离时，`getAllocatedContainerMemoryMb` 内部 catch 返回 0 导致 `getPoolAvailableMemoryMb` 误认为无任务运行、返回 POOL_B_MB（6144），而非保守的 0。正确做法是让 `getAllocatedContainerMemoryMb` 传播异常，在 `getPoolAvailableMemoryMb` 层统一捕获并保守返回 0。

### 下次预防

- [ ] 内存计算函数的错误边界应在"调用方"而不是"底层 DB 查询函数"处 catch，以便上层能做保守决策
- [ ] `allocate()` 函数的安全语义：DB 不可用时应拒绝派发（返回 false），而非假设池空闲
- [ ] 三池常量之和必须等于 TOTAL_CONTAINER_MEMORY_MB，否则 CI 校验失败（2048+6144+4096=12288 ✓）
