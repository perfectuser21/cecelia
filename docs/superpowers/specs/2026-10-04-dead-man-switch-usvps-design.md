# 死人开关改指 us-vps + opc-watchdog 去网关探针（设计）

## 背景
- `scripts/sentinel/dead-man-switch.sh` 的 psql 写死 `localhost:5432 -U postgres -d cecelia`。生产库 09-11 迁到 us-vps 后，MMV 本机没有 cecelia 库，脚本自 09-24 起每小时 Bark「无法连接 cecelia 数据库」假警，Brain 活性实际无人监控。
- 直接改连接会立刻误报：working_memory 里有 2 个已下线 job 的孤儿哨兵键（conversation-digest、capture-digestion，76 天未更新），脚本用 `min(updated_at)` 判新鲜度。
- us-vps `/opt/opc-watchdog/watchdog.sh` 不在任何仓库；其第 2 节网关探针检查已退役的 `openclaw-gateway` 容器，连败 3600+ 次、每小时假告警。

## 方案（选定）
1. dead-man-switch 连接参数可配置：`DMS_PGHOST`（默认 localhost）、`DMS_PGPORT`（默认 5432）、`DMS_PGUSER`（默认 postgres）、`DMS_PGDATABASE`（默认 cecelia）。默认值与旧行为一致。MMV crontab 设 `DMS_PGPORT=15432 DMS_PGUSER=cecelia`（经 `com.cecelia.pg-tunnel` 到 us-vps，口令走 `~/.pgpass`）。
2. 新鲜度判定改为：`STALE_MINUTES` 窗口内更新过的哨兵键数 `fresh_count >= EXPECT_KEYS` 才算健康；否则告警「只有 fresh/expected 个 job 在 N 分钟内报到」。孤儿键不再影响结果。总键数检查保留语义（用 fresh_count 取代）。
3. opc-watchdog 纳入 `scripts/ops/us-vps/opc-watchdog.sh`，以 us-vps 现行版本为基线，删除第 2 节网关探针与报到消息里的 Gateway 字段；其余探针（Brain、HK 盘、晨报、每日报到）不变。合并后 scp 同步到 us-vps `/opt/opc-watchdog/watchdog.sh`（保留 .bak）。

否决：改查 Brain HTTP（Brain 挂时无法区分 DB/进程，失去体外独立性）；哨兵挪到 us-vps 跑（违反零执行铁律）。

## 测试策略
- unit（bash 测试，vitest 驱动 / 或现有 sentinel 测试形态）：用假 psql（PATH 注入）模拟三种返回：①连接失败 → 告警；②fresh_count < expected（含孤儿键场景：总 74、fresh 72、expected 72 → 不告警；fresh 70 → 告警）→ 告警；③连接参数从 DMS_* 传入 psql 参数。Bark 用假 curl 记录调用。
- opc-watchdog：静态测试断言文件不含 `openclaw-gateway` 探针、`bash -n` 语法通过、Brain 探针段仍在。
- proven-to-fire：部署后用 `STALE_MINUTES=0` 手动跑一次，必须报红（推 Bark）；正常参数跑一次必须 OK。

## 影响
- 只影响 MMV 上这一个 cron 与 us-vps 这一个 systemd 服务的脚本；不碰 tick_enabled、不碰 Brain 代码。
