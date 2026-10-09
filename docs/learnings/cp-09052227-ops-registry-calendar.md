# Learning: 运行舱刀1——可观测性缺口的根源与拉取式投影

### 根本原因
- 「有哪些 agent、什么任务什么时间在哪台机器跑」四个要素分散在四层账本（Brain tasks 队列 / 各机 launchd / OpenClaw clawdbot.json / GHA cron），互相不知道对方存在，且没有任何投影页——不是面板没做，是**没有统一账本可读**。
- 两处"看起来能复用"的现成件实际不可用：`agent_ops_agents`(migration 274) 是 Path4 微信 RPA 专用表（CHECK 枚举锁死 + 275 外键），复用会全军覆没；现有 notion-push 9 个函数全是"一次性建页"模式，扛不住每 5 分钟变化的心跳数据。
- 原设计的"宿主 push daemon + 写端点"会引入整类新故障面（LaunchAgent 在本机 gui/501 域永不加载、internal token fail-open、5221/5222 静默错投、锁残留/spool）——改成 Brain 内 scheduler job 拉取（复用 launchd-patrol 的 host-exec ssh 逃逸）后这些整类消失。

### 下次预防
- 判"未接线/可复用"必须先读建表迁移原文与消费者（274/275 的 CHECK+外键 5 分钟就能看穿），禁凭表名想当然。
- 采集类功能默认先问"Brain 能不能拉"，拉不动才建 push 通道；push 通道 = 多一整类鉴权/错投/停摆故障面。
- 外部真实状态的采集铁三角：per-source 心跳（单腿断不许全量假红）、0 条=可疑须 source_status 佐证、宁 stale 不假数据（失败沿用上轮快照+显式标龄）。
- OpenClaw 配置真身只有 `docker exec openclaw-gateway cat /root/.openclaw/clawdbot.json`——宿主同名文件 5 份（备份/迁移快照，每次升级新增），任何 find/通配采集早晚把旧快照当现状。
- launchd 事实只认 `launchctl list` 已加载集合；plist 目录里的 .bak/.migrated 是退役残留。
- 跨时区 next_run 推算禁固定偏移（宿主 LA 有 DST、容器上海无），用 Intl 在目标时区逐分钟比对出绝对 UTC，算不准留空。

- [ ] 刀2：Dashboard 运行舱页消费 /agent-ops 两端点
- [ ] recurring_tasks 死排程（executeTick 废弃族）清理或复活，别让日历长期挂 ⚠️
