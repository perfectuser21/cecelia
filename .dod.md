# CI运行基线与休眠前端检查统一收口

Task: 7ce6c42d-b747-4831-85c3-2111ba886d54
GP-Anchor: none(infra)

- [x] PG接管测试用独立observer与精确owner阻塞身份观测，原11例与异常收束保护保留；同源真实PG22文件248例通过。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
- [x] Docker两阶段Node22与主CI一致，image build后保完整四旧步骤并增加真实容器major断言，错误major拒绝。
  Test: manual:node --test scripts/ci/__tests__/basic-image-runtime.test.mjs scripts/ci/__tests__/basic-fixed-core.test.mjs
- [x] 默认CI精确7定义18实例，四必需组严格成功才过；前端API、显式CLI、captures schema、Heartbeat与Nightly保留。
  Test: manual:node --test scripts/ci/__tests__/basic-parked-frontend.test.mjs scripts/ci/__tests__/basic-results.test.mjs scripts/ci/__tests__/basic-manual-ui-lane.test.mjs
- [x] 仅release-order取operation lock有限等待，其他store默认-n不改；超时/错误/信号闭锁且原顺序拒绝保持。
  Test: manual:node --test scripts/brain-image-retention-release-order.test.mjs scripts/ci/__tests__/basic-deploy-ordering.test.mjs
- [ ] 统一版本325、事实/DoD、完整Scripts与Ops、集成diff独立审查及真实PR镜像Node22门通过。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] 本次actual main CD成功且生产Brain真实Node22验真；Root接续采证前父Task保持in_progress，源码合并不等同生产完成。
  Test: manual:node scripts/ci/run-basic-check.mjs image

## 悦升 101 末次清理握手复核

- [x] 只允许原清理中已经正常结束的唯一 HOME 和特定观察顺序，最后一次 version 的未知握手须由完整叶账原字节支持。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 拒绝缺失或被改写的叶账、未知出现在 HOME、未知命令及不匹配的桌面和中央锁。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 已有探针结算、重放和隔离租约回归通过，保留原失败回执。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js

Brain Task 594f3bdb-1363-456b-b033-2e1f095d1641
