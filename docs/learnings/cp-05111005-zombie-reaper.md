# Learning: Zombie In-Progress Task Reaper (Walking Skeleton P1 B2)

**分支**: cp-05111005-zombie-reaper  
**日期**: 2026-05-11  
**类型**: 新功能

---

### 根本原因

Brain dispatcher 用 `task_pool` 管理并发槽位。当 `in_progress` 任务所属进程挂死、被 OOM kill、
或网络断开后，任务的 `updated_at` 停止更新，但 `status` 永远卡在 `in_progress`。
这些僵尸任务占据槽位，导致 `dispatcher available=0`，新任务无法派发，整个调度系统死锁。
本次事故：9 个 zombie 占满 task_pool，需要人工 `UPDATE tasks SET status='failed'` 才能解锁。

---

### 下次预防

- [ ] zombie-reaper 已接入 server.js，Brain 重启后自动启动，每 5 分钟扫一次
- [ ] 默认阈值 30 分钟 idle，可通过 `ZOMBIE_REAPER_IDLE_MIN` 环境变量调整
- [ ] 所有 zombie 处理均写 `error_message='[reaper] zombie: in_progress idle >Xmin'`，可审计
- [ ] 单行 UPDATE 失败不影响其他任务处理（独立 try/catch 保护）
- [ ] 监控告警：若 Brain 日志中出现 `[zombie-reaper] Found N zombie` 且 N > 5，需检查执行器健康状态

---

### 设计决策

1. **新建 `zombie-reaper.js` 而非修改 `zombie-sweep.js`**：职责分离。zombie-sweep 处理进程/worktree/lock-slot，reaper 专注 DB task 状态修复。
2. **不做 retry 自动重新派发**：只标 failed，让 Brain 自然重新生成任务，避免过度耦合。
3. **参数化 idleMinutes**：测试可注入自定义阈值，生产用 ENV 覆盖。
4. **server.js 用 dynamic import + try/catch 注册**：与其他 interval 模块模式一致，启动失败不 crash Brain。
