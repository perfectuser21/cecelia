# Learning: Watchdog Crisis 杀 top 25%

## 分支
cp-03191420-fix-watchdog-crisis-kill

## 变更摘要
Crisis 模式从只杀 RSS 最大的 1 个进程改为杀 top 25%（最多 4 个）。

### 根本原因
16 个进程同时高内存时，杀 1 个只释放 ~600MB，5 秒内压力不降反升。需要一次性释放足够内存让系统稳定。

### 下次预防
- [ ] 资源保护机制的杀进程策略要和最大并发数匹配
- [ ] Crisis 杀进程后验证：释放的内存 > 当前 deficit
