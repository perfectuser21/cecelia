# Worker死亡恢复夹具的写入者收束验收

Task: fb0def7a-9a6e-44a3-82cc-7c088276282e
GP-Anchor: none(infra)

- [ ] 真实detached supervisor持有最终写入门时不删除夹具；完成收据持久化并退出后才清理，使用同源protectedRead拒绝符号链接收据并保留现场，不能以固定延时或杀监督者代替。
  Test: manual:npm test --workspace packages/brain -- scripts/fleet-worker/workflow-runner.test.js
- [ ] 原33例与所有OS Worker死亡恢复/拒绝恢复场景保留，业务和Commander调用仍各一次；owned Worker退出后才删除目录。
  Test: manual:npm test --workspace packages/brain -- scripts/fleet-worker/workflow-runner.test.js
- [ ] 本次仅测试及fixture helper，无Brain运行源码或版本改写；事实与版本同步门保持通过。
  Test: manual:node scripts/facts-check.mjs
