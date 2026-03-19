# Learning: 物理容量安全边际

## 分支
cp-03191420-fix-capacity-safety-margin

## 变更摘要
SAFETY_MARGIN 从 0.85 降到 0.80，calculatePhysicalCapacity 默认 memPerTaskMb 从 350 改为 500。

### 根本原因
MEM_PER_TASK_MB=400 是平均值，峰值可达 600MB。16GB 机器跑满 16 slot 时只剩 2GB 余量，任何峰值都可能触发 OOM。

### 下次预防
- [ ] 容量规划基于峰值而非平均值
- [ ] 新增 slot 上限时先验证：slots × peak_mem + system_reserved < total_mem
