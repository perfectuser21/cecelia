- [ ] 复核133份待定烟测，清退6份失效入口和20份重复脚本；同步分类、写目标及分类器fixture，保留现役业务和权限资源边界。
  Test: manual:bash -c 'node --test packages/brain/scripts/smoke/__tests__/*.node-test.mjs scripts/ci/__tests__/basic-task-static-readers.test.mjs'
- [ ] 原生路由、派发、共享时钟、交接、资源预算等替代测试仍由默认unit收集且通过。
  Test: manual:npm exec -w packages/brain -- vitest run src/routes/__tests__/abilities.test.js src/__tests__/dispatch-fail-autoblock.test.js src/orchestrator/__tests__/handoff-schemas.test.js src/__tests__/slot-allocator.test.js
- [ ] 删除迁移494外层包装后，真实PG文件仍被unit排除、由deep完整选中；其他PG边界保持。
  Test: manual:npm exec -w packages/brain -- vitest run ../../tests/brain-ci-pg-layering.test.ts
- [ ] 默认scripts、事实、版本与DoD门禁通过，独立复审后正常PR与完整CI交付。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
