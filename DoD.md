# US Linux 根卷容量观测验收

Task: 6a0fde14-8871-4bb0-8ce1-db449ce71d68
GP-Anchor: none(infra)

- [ ] Linux 根卷采样以生产部署同路径绑定和预期设备为准，缺失或错盘报失败。80% 触发 P2，90% 触发 P1。
  Test: manual:npm test --workspace packages/brain -- src/cron/linux-root-disk.test.js
- [ ] Staging、预览和 canary 不采样。Mac SSH 磁盘守卫与手动接口行为保留。
  Test: manual:npm test --workspace packages/brain -- src/cron/linux-root-disk.test.js src/cron/disk-guard.test.js src/routes/cron.test.js
- [ ] Brain 版本同步。
  Test: manual:bash scripts/check-version-sync.sh
