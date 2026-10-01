## Brain {VERSION} — 本地smoke生产写入护栏（原任务617259ae）

- 默认拒绝真实写入；显式授权仍须验证本地Docker daemon、隔离容器、实际连接及健康身份，生产代理与未知目标保守拒绝。
- 63个SQL候选逐项登记55写与8只读，Node PG和下游连接按实际优先级核验；curl与psql禁读启动配置，保留真实本机边界回归。
- Map Manifest真实PG正例归专属测试Brain；Walking棘轮明确委托已合入的required owner，不执行且不冒充通过；保留全部主线业务与验收。
