# Learning: Area 公平调度

## 分支
`cp-03192320-area-fair-dispatch`

### 根本原因
Pool A/B/C 按"谁用"分，Area 线按"做什么"分，两个维度完全没关联。所有业务线任务混在 FIFO 队列里，Cecelia 自身进化永远排不上。

行业最佳实践（YARN Fair Scheduler）：每条线有保底(min)、上限(max)、权重(weight)，保底优先满足，空闲借用，不杀进程。

### 下次预防
- [ ] 新增业务线时必须在 brain_config.area_slots 配置 min/max/weight
- [ ] 定期检查各线 utilization，保底太高浪费、太低饿死
