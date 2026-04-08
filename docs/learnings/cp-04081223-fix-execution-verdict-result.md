# Learning: execution-callback verdict 写入缺失

## 根本原因
harness pipeline 的 execution-callback 只用 verdict 做下游任务路由决策，从未持久化到 `tasks.result`。这导致 Brain Dashboard 看不到任务的最终结论，Brain 重启后也无法重建 pipeline 状态。

## 下次预防
- [ ] 新增 harness 任务类型时，在 callback 末尾必须加 `UPDATE tasks SET result` 写入
- [ ] 任务链每个节点的 verdict 都是可观测性的关键字段，不能只用于路由
- [ ] harness_ci_watch 创建时的 pr_url 可能是 null（generate 任务写 pr_url 有时序延迟），应警告不阻断
