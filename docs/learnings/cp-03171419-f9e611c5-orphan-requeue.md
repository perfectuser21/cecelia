# Learning: syncOrphanTasksOnStartup 孤儿按 reason 分流

## 任务
fix(executor): syncOrphanTasksOnStartup 孤儿改 requeue — 区分可重试 vs 真实失败

## 根本原因

Brain 重启时两个竞争实现同时运行：
- `startup-recovery.js` 无条件 requeue 所有 in_progress 任务
- `executor.js syncOrphanTasksOnStartup` 无条件 fail 所有孤儿

executor.js 的 fail 会覆盖 startup-recovery.js 的 requeue，导致 `process_disappeared` 原因的任务被错误标记为 failed，造成静默数据丢失。

## 修复方案

在 `syncOrphanTasksOnStartup` else 分支按 reason 分流：
- `process_disappeared` → `status = queued`（Brain 重启可重试）
- 其他（oom_killed / oom_likely / killed_signal / timeout）→ `status = failed`

## 下次预防

- [ ] 凡新增"将任务标记为 failed"逻辑时，检查是否与 startup-recovery.js 有竞争
- [ ] 孤儿处理需先判断 reason，Brain 重启中断的任务默认可重试
- [ ] mock `platform-utils.js` 的 `getDmesgInfo` 可控制 `checkExitReason` 返回的 reason
