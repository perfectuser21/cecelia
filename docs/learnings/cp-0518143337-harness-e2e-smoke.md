# Learning: 缺乏 harness pipeline E2E smoke（2026-05-18）

### 根本原因
所有 harness 测试全是 mock + 单元测试，没有任何测试能验证"真实 Brain 上 pipeline 跑完不卡死"。keepalive 挂了、fix loop 不接、routing 断裂等问题都无法被 CI 提前发现。

### 下次预防
- [ ] 新 harness 功能合并前，先在真实 Brain 跑一次 `harness-pipeline-lifecycle-smoke.sh` 验证流程不卡
- [ ] 每周定时或 release 前手动跑：`bash packages/brain/scripts/smoke/harness-pipeline-lifecycle-smoke.sh`
- [ ] smoke 脚本成功标准：completed 或 failed 均为 PASS，超时才是 FAIL
