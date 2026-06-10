# Learning: 双层超时只修一层 = 没修（外层 deadline 仍砍头活 generator）

## 现象

PR #3330 给 callback 等待加了 liveness 感知（soft timeout 100min + hard ceiling），
但外层 SUBGRAPH_WAIT 90min deadline 比内层 soft timeout 先到——活 generator 依旧在
90min 被外层砍头、返回 'queued'、不 kill 容器。修复看似落地，主路径行为没变。

### 根本原因

1. 同一等待有两层独立超时（外层 deadline 90min、内层 soft timeout 100min from
   spawnedAt），只给后触发的那层加保护 = 保护不可达。修超时类 bug 必须枚举所有
   会先触发的竞争超时。
2. `status` channel 默认值 'queued' 被两处终态返回直接透传（外层 deadline +
   死亡分支 resume 失败路径），下游 Serial gate 把"默认值"误读为终态。
   channel 默认值绝不能当终态汇报。
3. 并行修复会话（#3330 与本支同日同根因）合并先后造成重复工作；rebase 前先 diff
   main 是否已覆盖，只提增量。

### 下次预防

- [ ] 修任何超时逻辑前，先列出同一路径上所有计时器及触发顺序（外层 deadline /
      soft timeout / hard ceiling / watchdog），证明修的是先触发的那个
- [ ] 终态返回禁止透传 channel 默认值（'queued'/'pending'），必须显式映射
- [ ] 放弃等待的每条路径（不只一条）都必须回收执行体
- [ ] 发现 main 已有同名修复时，先 diff 增量再决定 rebase 还是重切小分支
