# PRD: Zombie In-Progress Task Reaper (Walking Skeleton P1 B2)

## What

自动清理 Brain DB 层卡死的 `in_progress` 任务（僵尸任务），防止 dispatcher 死锁。

## 背景

Brain dispatcher 依赖 `task_pool` 槽位。`in_progress` 任务若进程挂死、`updated_at` 停止更新，
会永久占用槽位导致 `available=0`，新任务无法派发。

## 成功标准

- [x] `reapZombies` 正确识别 `status='in_progress' AND updated_at < NOW() - INTERVAL 'N minutes'`
- [x] 匹配的任务被标记为 `status='failed'`，`error_message` 含 `[reaper] zombie` 前缀
- [x] 未超时的 `in_progress` 任务不受影响
- [x] `completed`/`failed` 状态任务不在 SELECT 范围内
- [x] `startZombieReaper` 每 5 分钟触发一次，server.js 启动时注册
- [x] 阈值可通过 `ZOMBIE_REAPER_IDLE_MIN` ENV 变量配置（默认 30 min）

## DoD

- [x] [ARTIFACT] `packages/brain/src/zombie-reaper.js` 存在且导出 `reapZombies`、`startZombieReaper`、`ZOMBIE_REAPER_INTERVAL_MS`
- [x] [ARTIFACT] `docs/learnings/cp-05111005-zombie-reaper.md` 存在且含 `### 根本原因` + `### 下次预防` + `- [ ]`
- [x] [BEHAVIOR] zombie-reaper 单元测试全部通过
  - Test: `tests/zombie-reaper.test.js`
- [x] [BEHAVIOR] server.js 启动时注册 zombie reaper
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('startZombieReaper'))process.exit(1)"`
