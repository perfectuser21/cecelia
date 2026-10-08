## Brain {VERSION} — 消费者来源历史拒绝执行

- release拒绝消费者Workflow及Activity来源证据；此证据不代表完整可执行定义。
- 新运行、幂等绑定和历史续跑均拒绝consumer_evidence，保留正常执行历史与原current。
- 两个真实PG回归文件覆盖发布与续跑，未新增解析器、依赖、来源登记或激活权限。
