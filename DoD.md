# 清退旧 KR/OKR 自动链并补齐发布排空诊断

Task: b556cbb4-4062-4297-8b7c-a6d66c5c8320
GP-Anchor: none(infra)

- [x] 退出旧 KR/OKR 专属脚本与专项测试，保留正式 KR API、对象同步与实际 Ops 收集入口。
  Test: manual:node --test scripts/ci/__tests__/basic-integration-once.test.mjs
- [x] 排空客户端只记录验证后的白名单证据，保留现行协议、身份校验、等待预算与取消行为。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-drain-evidence.test.mjs
- [ ] 集成源码通过完整 Scripts/Ops 与独立 review，正常 PR 严格 CI 合并。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts && node scripts/ci/run-basic-check.mjs ops
- [ ] 后继实际 main CD、native 发布与生产 Node22 验收由 Root 读回，源码合并不能代替生产成功。
  Test: manual:curl --fail http://localhost:5221/api/brain/health && gh run view --log --repo perfectuser21/cecelia

## 悦升 101 只读预检超时复核

- [x] 精确核对全部只读预检叶账和最后一次 version 的握手缺失。控制器原 124 及两个随后拒绝均必须读回。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 已固化的公司元数据只允许同一公司、租户、版本、线路和 run 的单条快照。原 Task、设备、租约和零业务范围核验保留。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 原有结算、幂等重放和清场归位契约继续通过。保留原 run 的失败回执和新证据摘要。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js

Brain Task 9143bd3d-35e8-43d6-a546-609db623dcd0
