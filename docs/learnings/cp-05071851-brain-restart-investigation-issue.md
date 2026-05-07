# Learning: Brain 容器周期性重启 P0 诊断（仅产出 issue 文档）

- 分支: `cp-05071851-brain-restart-investigation-issue`
- 任务: docs(issues) — 不修代码，只产出诊断报告
- Brain task: `1ba9506a-d7d9-4269-9b96-836951fce6a5`

## 这次学到了什么

- Brain 容器周期性 SIGTERM exit 0 重启的根因不是 OOM、不是 crash、不是宿主 cron 定时杀，而是 **Brain 自己的 `capability-probe → brain-rollback.sh → docker compose up -d`** 链路 self-recreate
- 14 天内 198 次 rollback 全部 success=false，但容器全部被 recreate 完成 —— rollback 脚本的 health 检查被宿主 nohup Brain（5221 端口）误导
- 双 Brain 拓扑（容器 + watchdog 拉起的宿主 nohup）是 contributing factor：宿主 Brain 抢占 5221 端口 → 容器 Brain 被架空 → 外部观测全是错觉
- shutdown trace（`/Users/administrator/claude-output/brain-shutdown-trace.jsonl`）+ `cecelia_events` 表 + `logs/watchdog.log` 三个数据源交叉印证才能定位（任意单一数据源都看不全）

### 根本原因

将业务功能性指标（rumination/consolidation/self_drive_health）当做基础设施健康指标用，并在失败时执行 `docker compose up -d` 这种"recreate 容器"动作 —— image 不变、bug 不变、recreate 永远救不活。形成无限正反馈死循环：业务模块坏 → probe 失败 3 次 → recreate 容器 → 进程清白但 bug 不变 → 1h 后再失败 3 次 → 又 recreate。

### 下次预防

- [ ] capability-probe 必须区分 `severity: infra | business`，业务类失败只发告警不 recreate（PROBES 数组 entry 加字段）
- [ ] 任何"自愈/回滚"脚本调用 `docker compose up -d` 之前必须验证调用方不在被回滚的容器里（否则就是给自己开枪）
- [ ] 容器化 SSOT 要立得住：宿主 nohup 的 fallback 路径要么删掉、要么明确锁死只在容器 Brain 完全死透时才拉起（`docker inspect` 状态判断而非 host curl 判断）
- [ ] rollback 链路必须有 cooldown，同一 probe 6h 内只允许 1 次回滚，避免 thrash
- [ ] `brain-shutdown-trace.jsonl` 已经有了，应固化到日常巡检：`wc -l` 突然增长是 Brain 异常退出的早期预警

## 调查方法学

- 先看 `docker inspect ... --format '{{.State.StartedAt}} ... ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}'` 排除 OOM/crash
- `lsof -nP -i :5221 -sTCP:LISTEN` 比 `docker ps` 更先暴露双进程拓扑
- `cecelia_events WHERE event_type='probe_rollback_triggered'` 是 Brain 自己写的回滚事件流，时间序列+成功率比看 docker events 更全
- shutdown trace（process.on('SIGTERM') 持久化）是 graceful exit 唯一不丢失的现场，docker logs 在 recreate 时会丢
