# Learning: Brain 每日 DB 备份自动调度

**分支**: cp-0428214054-cp-04281200-brain-backup-cron
**日期**: 2026-04-28

## 背景

`thalamus.js` 的 `ACTION_WHITELIST` 里已有 `trigger_backup` 动作，但从未被任何 scheduler 定期触发。本次添加每日凌晨 2:00（Asia/Shanghai = UTC 18:00）自动触发。

## 实现模式

遵循 `daily-scrape-scheduler.js` 的时间窗口 + 幂等模式：
- `isInDailyBackupWindow()` 纯函数，UTC 18:00-18:05 窗口
- `scheduleDailyBackup()` 幂等：20h 内有同类任务则跳过
- tick-runner.js 第 10.22 位置 fire-and-forget 调用
- `/api/brain/backup/trigger-now` 路由支持手动 force 触发

### 根本原因

`trigger_backup` 动作一直孤立在 thalamus whitelist 中，没有对应的调度器驱动它。

### 下次预防

- [ ] 新增 ACTION_WHITELIST 动作时，同步检查是否有对应的 scheduler 调用它
- [ ] 若是定时动作（每日/每周），在 tick-runner.js 中找对应编号位置（10.x 序列）
- [ ] smoke.sh 只需要验证文件导出和 DB 任务创建，不需要等 Brain 真启动

## 测试策略

- unit：`daily-backup-scheduler.test.ts` 10 个用例，覆盖时间窗口边界 + 幂等性 + 任务创建
- smoke：`daily-backup-scheduler-smoke.sh` 验证真 Brain 环境下 trigger-now API 可用
