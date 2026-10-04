# Learning：死人开关查错对象 13 天无人发现

### 根本原因
- 生产库 09-11 迁到 us-vps，但体外哨兵 `dead-man-switch.sh` 把连接写死在 `localhost:5432`。MMV 本机没有 cecelia 库，从 09-24 起每小时报「无法连接数据库」，靠冷却压着，等于把 Brain 活性监控关掉了 13 天。
- 直接改连接会立即误报：判活用 `min(updated_at)`，working_memory 里留着已下线 job 的孤儿哨兵键（76 天未更新）。
- us-vps 的 opc-watchdog 是裸脚本、不在仓库，网关退役时只改了 disk-gateway-guard，漏改这里，网关探针连败 3600+ 次。

### 下次预防
- [ ] 迁移数据库/服务位置时，`git grep` 全部写死的 host:port（含体外哨兵、cron 脚本）一并改，并在迁移清单里列「体外监控」项。
- [ ] 判活不要用「全体最旧」这类会被孤儿数据拖垮的聚合，用「窗口内报到数 ≥ 预期数」。
- [ ] 生产机上的运维脚本一律进仓库（`scripts/ops/<host>/`），禁止机器上直接改。
- [ ] 哨兵要 proven-to-fire：部署后用 `STALE_MINUTES=0` 亲眼看它报红一次。
