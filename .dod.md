# 清退无现役生产者的Preview缓存常驻执行链

Task: 1f12784d-2454-4b76-9ed9-690865d0f405
GP-Anchor: none(infra)

- [x] 真实默认调度轮与Janitor注册表仅保留镜像策略，退役缓存策略不能执行或配置。
  Test: manual:npx --no-install vitest run --root packages/brain src/__tests__/janitor.test.js src/__tests__/scheduler-jobs.test.js
- [x] 外部旧Janitor请求在路由与中央writer早于DB拒绝，合法镜像内部能力仍正常。
  Test: manual:npx --no-install vitest run --root packages/brain src/__tests__/janitor-authority.test.js src/__tests__/image-retention-authority.test.js
- [x] 历史缓存执行记录继续受外部unknown保护，通用Janitor执行与镜像合同不退化。
  Test: manual:npx --no-install vitest run --root packages/brain src/__tests__/external-executor-predicate.test.js src/__tests__/executor-contracts.test.js src/__tests__/janitor-runner.test.js
- [x] 专属默认/deep/Ops测试集合精确退出；原生staging、手机与Notion保留，Scripts和sourceproof真实入口通过。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] 版本事实同步，持久缓存/回执/锁/私有SQLite与真实服务不在代码任务修改范围；Task保持in_progress待Root正式发布停机验收。
  Test: manual:node scripts/facts-check.mjs

## 悦升 101 收尾复核

- [x] 原运行只能是 101 独立 Skill，原任务、TaskRun、冻结绑定、已退出宿主及隔离本机锁须匹配。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 同次只存在已回执的 ADB 只读探针。原清理收据原字节、新鲜的默认桌面读回及零业务效果共同支持复核。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 原中央锁按设备、owner 与版本条件清理。已空闲的同版本保持空闲。旧收据和复核历史保留。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js
- [x] 独立 PostgreSQL HTTP 回归覆盖正常结算、无修改的读回、幂等重试、错误桌面、非只读 adb 和租约版本变化。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js

Brain Task 7ea9603c-73fb-4b04-b360-5ee5cae849fb
