# 修复 Notion 101 派单的业务绑定

Task: 8b4954b4-29b2-449f-9e6a-3a70d8bc67bd
GP-Anchor: none(infra)

- [ ] Notion 101 到点后使用宿主登记的轻量版本及租户绑定。过期和缺失绑定可见，其他委派路由保持。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/notion-leadgen-dispatch.test.js src/__tests__/notion-push-sync-marked-ingest.test.js
- [ ] 同一页在真实隔离 PostgreSQL 中并发起单只生成一条任务，回执只更新源页并保留失败原因。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-foundation.pg.integration.test.js
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/notion-gtd-sync-push-and-stops.test.js src/__tests__/notion-qiumi-receipt-details.test.js
