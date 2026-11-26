# 原生Agent测试清理竞态验收

Task: 4938df31-0c88-4c54-a47b-9c5cbc81fa8e
GP-Anchor: none(infra)

- [ ] 保留原32例业务断言，未知/复用PID不误杀保护保持。
  Test: manual:node --test packages/brain/scripts/native-agent/__tests__/native-agent.node-test.mjs
- [ ] 暂停真实本人worker的回归先红后绿；确认worker/native/CLI停止后才能删除fixture目录。
  Test: manual:node --test packages/brain/scripts/native-agent/__tests__/native-agent.node-test.mjs
- [ ] 固定候选约束、完整Ops与DevGate通过，不用删除重试或吞错误掩盖。
  Test: manual:node --test packages/brain/scripts/native-agent/__tests__/candidate-fixture.node-test.mjs
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] 最终PR/main完整CI、自动隔离验收和生产SHA读回通过；版本保持尚未发布的305。
  Test: manual:bash scripts/check-version-sync.sh
