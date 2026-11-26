# 清退无消费者 CI 治理与 Preview 主机发布残留

Task: 4887d20a-3760-4349-a138-cbb62666ddc4
GP-Anchor: none(infra)

- [ ] 逐项消费者审计后清退旧CI治理脚本及其独占测试，共享契约、鉴权和现行门禁保留。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] 清退无调用的Preview主机安装发布器及专属fixture；现役缓存代理、凭据和销毁链完整。
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] 默认Brain测试收集逐路径与基线一致；本轮不新增workflow或job。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-unit 1
