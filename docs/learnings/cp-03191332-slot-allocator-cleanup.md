# Learning: 疏通 Slot 分配系统

## 分支
cp-03191332-slot-allocator-cleanup

## 变更摘要
去掉 slot 分配链路上的多层静态 Cap 矛盾，让动态资源探测成为唯一容量判断依据。

### 根本原因
三文件 `MEM_PER_TASK_MB` 各不相同（800/500/350），`MAX_PHYSICAL_CAP` 也不一致（10/8），加上三池静态预分配和 Token 压力双重截断，导致 7 slot 总预算只剩 1 个可派发 slot。动态探测系统（`checkServerResources`）虽已完整实现，但被静态限制覆盖。

### 下次预防
- [ ] 新增资源常量时，搜索全仓库确认没有重复定义（`grep -r MEM_PER_TASK`）
- [ ] 添加静态 cap 前先确认它不会覆盖已有的动态系统
- [ ] slot 分配逻辑变更后，用 `/api/brain/slots` 端点验证实际输出
