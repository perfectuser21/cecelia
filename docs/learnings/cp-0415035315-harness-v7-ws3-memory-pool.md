# Learning: WS3 内存调度 + 三池隔离

**任务**: ced4b570-1101-47b7-bd2b-c20d82dd47f5
**分支**: cp-0415035315-ced4b570-1101-47b7-bd2b-c20d82
**日期**: 2026-04-15

### 根本原因

原有 slot-allocator.js 以抽象 slot 数（`MAX_SEATS=16`）为调度单位，无法反映 harness 容器的实际内存消耗差异。harness_generate 任务（heavy, 1024 MB）与 dev 任务（normal, 512 MB）共享同一个 slot 池，导致 harness 任务叠加时内存溢出风险未被感知。

### 解决方案

引入三池内存模型（`TOTAL_CONTAINER_MEMORY_MB=12288`）：
- Pool A（2048 MB）：前台用户会话
- Pool B（6144 MB）：harness pipeline 任务，独立隔离
- Pool C（4096 MB）：其他自动派发任务

`allocate(poolName, containerSizeMb)` 在派发前检查目标池可用内存。池间资源完全隔离，Pool B 满载不阻塞 Pool C 派发。

### 下次预防

- [ ] 新增 task_type 时，记得在 `getTaskPoolName()` 和 `getContainerSizeMb()` 中定义对应的池和大小
- [ ] CONTAINER_SIZES 常量在 slot-allocator.js 中定义，executor.js（WS2）也有独立定义——避免两处不一致，考虑统一到 executor.js 中
- [ ] Pool B 的 heavy 容器大小（1024 MB）与实际 Docker 限额需对齐（executor.js CONTAINER_SIZES.heavy）
