# Notion 下单触发 M4 小白 B 站只读核验

Task: ad5fa1a0-89f0-48fa-9368-77277a580332
GP-Anchor: none(infra)

- [x] 英文 Tasks 的唯一授权页进入 B 站只读入单，错误页面被拒，原页接管回执带同一任务编号。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/notion-push-sync.test.js src/__tests__/notion-leadgen-dispatch.test.js
- [x] 隔离 PostgreSQL 证明同一 Notion 页面并发只建一单。固定 worker 执行一次，同一清单对账 Activity 与播放 Step，再将运行编号和摘要回写原页。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-foundation.pg.integration.test.js
