# PRD: Brain 每日自动 DB 备份调度

**Task**: cp-04281200-brain-backup-cron
**Branch**: cp-0428214054-cp-04281200-brain-backup-cron
**Type**: feat

## 背景

`thalamus.js` 的 `ACTION_WHITELIST` 里有 `trigger_backup` 动作，但无任何 scheduler 定期触发。每日 DB 备份依赖人工触发，存在遗漏风险。

## 目标

在 Brain tick loop 中添加每日检查：北京时间 02:00（UTC 18:00）自动往任务队列插入 `trigger_backup` 任务，幂等（同天只触发一次）。

## 实现范围

- `packages/brain/src/daily-backup-scheduler.js` — 新增调度器
- `packages/brain/src/routes/backup.js` — 新增 POST /api/brain/backup/trigger-now
- `packages/brain/src/tick-runner.js` — 10.22 位置接入
- `packages/brain/server.js` — 注册 backup 路由
- `packages/brain/src/__tests__/daily-backup-scheduler.test.ts` — 单元测试
- `packages/brain/scripts/smoke/daily-backup-scheduler-smoke.sh` — smoke 测试

## 成功标准

- [x] `isInDailyBackupWindow()` UTC 18:00-18:04 返回 true，其他时间返回 false
- [x] `scheduleDailyBackup()` 在时间窗口内且今天未创建过 → 插入 `trigger_backup` 任务
- [x] `scheduleDailyBackup()` 今天已创建过 → 返回 `alreadyDone=true`，不重复插入
- [x] tick-runner.js 10.22 已调用 `scheduleDailyBackup(pool)`
- [x] POST /api/brain/backup/trigger-now 支持 force=true 手动触发
- [x] 单元测试 10/10 全绿

## DoD

- [x] [ARTIFACT] `packages/brain/src/daily-backup-scheduler.js` 存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/daily-backup-scheduler.js')"`

- [x] [ARTIFACT] `packages/brain/src/routes/backup.js` 存在
  Test: `manual:node -e "require('fs').accessSync('packages/brain/src/routes/backup.js')"`

- [x] [BEHAVIOR] tick-runner.js 已接入 scheduleDailyBackup
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('scheduleDailyBackup'))process.exit(1)"`

- [x] [BEHAVIOR] isInDailyBackupWindow UTC 18:00 返回 true
  Test: `tests/packages/brain/src/__tests__/daily-backup-scheduler.test.ts`

- [x] [BEHAVIOR] scheduleDailyBackup 幂等：已触发时跳过
  Test: `tests/packages/brain/src/__tests__/daily-backup-scheduler.test.ts`
