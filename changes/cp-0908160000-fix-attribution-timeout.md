## Brain {VERSION} — 修阶段归因 ETIMEDOUT + 预筛提效

- 刀8 部署后阶段归因整段静默跳过：`spawnSync /bin/sh ETIMEDOUT`。根因是拉 300 条 × ~80KB ≈ 24MB 超过 host-exec 默认 20s 超时。
- `defaultExec` 支持 `opts.timeoutMs` 覆盖（超时机制本身保留，回归测试双向验证：3s 内跑通 1s 命令、500ms 超时仍会抛）；归因单独用 120s。
- **SQL 预筛**：只拉真正含业务阶段的执行（`position(chr(38454)||chr(27573)||chr(32) IN d.data) > 0`，用 chr() 拼中文避开 shell/psql 多层引号转义）。实测效果——预筛前 120 条里仅 7 条含阶段（19.5MB / 95 秒，96% 是通道类废数据）；预筛后 30 条里 24 条含阶段（5.5MB / 46 秒），归因样本反而更多且留足超时余量。
