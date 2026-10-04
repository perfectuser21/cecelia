## Brain {VERSION} — 死人开关改指 us-vps 生产库、孤儿哨兵键不再误报；opc-watchdog 纳入仓库

- `scripts/sentinel/dead-man-switch.sh`：psql 连接改为 `DMS_PGHOST/DMS_PGPORT/DMS_PGUSER/DMS_PGDATABASE` 可配置（默认值兼容），MMV 经 pg-tunnel `localhost:15432` 指 us-vps；判活由「最旧哨兵键年龄」改为「STALE 窗口内报到键数 ≥ 预期 job 数」，已下线 job 的孤儿键不再拖垮判定。
- `scripts/ops/us-vps/opc-watchdog.sh`：us-vps 裸脚本纳入版本管理，去掉已退役 openclaw-gateway 网关探针（原连败 3600+ 次、每小时假告警）。
- 回归：`packages/brain/scripts/smoke/dead-man-switch-usvps-smoke.sh`（决策 b08a085c）。
