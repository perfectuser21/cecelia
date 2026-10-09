# Learning：封停 tick 后部署台账 pending 卡死全部部署

### 根本原因
- 部署收账 `ledger.finish` 要求 `/api/brain/health` 为 healthy；而 healthy 的公式要求 tick 循环在跑。决策 751f73be 有意封停 tick 之后，健康恒为 degraded——容器换成功了，收账永远失败，台账 `pending` 不清，下一次部署在 `begin` 就以 `DEPLOYMENT_PENDING` 退出。03:49 起 Gate 3 连续失败，1.370.13/1.371.0 与闹钟总账 517 迁移全部上不了产。
- 首次排查被「sidecar 记 healthz_poll_timeout_or_identity_mismatch」误导，以为是身份不符；实际 `finish` 的 `DEPLOY_HEALTH_MISMATCH` 才是真因，要读 `observed.status`。
- 两个有意设计（封停 tick、部署要求 healthy）各自合理，叠加后互相锁死，没有任何一处会告警。

### 下次预防
- [ ] 做「有意关闭某器官」的决策时，`git grep` 所有把该器官存活当作前置条件的闸（健康公式、部署收账、死人开关），逐个声明「有意关闭」的口径。
- [ ] 部署收账失败要有可见告警（pending 超过一个部署周期未清 → Bark），不要靠下一次部署失败才发现。
- [ ] 一次性收账用台账自带的 `finish` + 显式只折算「有意封停」这一个原因，不手写收据；长期口径固化进 `deployHealth` 并配测试。
