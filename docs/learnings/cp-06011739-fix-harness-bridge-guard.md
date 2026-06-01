### 根本原因

dispatcher.js 对所有任务类型统一检查 cecelia-bridge 可用性。但 harness_initiative 走 Docker spawn 路径，完全不依赖 bridge。bridge 不在时 harness 被错误 revert 到 queued，pipeline 永远无法启动。

这个 bug 之前被掩盖，是因为 bridge 一直在后台运行；今天重启 Brain 容器后 bridge 断了，才首次暴露。

### 下次预防

- [ ] 新增任务执行路径时，同步检查 dispatcher 的 guard 条件是否需要豁免
- [ ] harness_initiative / harness 系列任务统一走 Docker，不依赖 bridge；任何 bridge 相关 guard 对 harness 均无效
- [ ] 任务类型路由矩阵应维护在一处（task-router.js），dispatcher 的 guard 应查询该矩阵而不是硬编码
