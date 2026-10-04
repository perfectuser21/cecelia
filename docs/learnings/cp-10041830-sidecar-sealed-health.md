# Learning：同一个硬编码口径在部署链里有两份，只修一处等于没修

### 根本原因
- 「healthy」被部署链两处各自硬编码：官方收账 CLI（TS/ESM）和蓝绿 sidecar（shell 内联 node）。#5947 只修了前者；1.371.1 部署时 sidecar 那份仍要求 `status==="healthy"`，封停 tick 下恒为 degraded，sidecar 在等 healthz 一步退出，drain 没恢复、台账没收账。
- 我在 #5947 里没有 `git grep` 全部读 `/health` 的 status 的地方，靠部署实跑才发现第二处。

### 下次预防
- [ ] 修「某个口径」前先 `git grep` 全仓所有同口径的读取点（含 shell 内联脚本），一次修齐，并让它们共用同一个实现。
- [ ] 部署链改动必须靠一次真实部署验收：看台账 pending 是否清空，不只看单测绿。
- [ ] 收账失败要有告警，不要靠下一次部署才发现。
