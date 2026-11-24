# 修复 Notion 101 派单的业务绑定

Task: 8b4954b4-29b2-449f-9e6a-3a70d8bc67bd
GP-Anchor: none(infra)

- [ ] Notion 101 到点后使用已登记的 101 业务版本与轻量直执行宿主。过期和缺失绑定可见，其他委派路由保持。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/notion-leadgen-dispatch.test.js src/__tests__/notion-push-sync-marked-ingest.test.js
- [ ] 同一页在真实隔离 PostgreSQL 中并发起单只生成一条任务，回执只更新源页并保留失败原因。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-foundation.pg.integration.test.js
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/notion-gtd-sync-push-and-stops.test.js src/__tests__/notion-qiumi-receipt-details.test.js
- [ ] 独立执行入口只发起一次 Agent，收尾前读取原业务结果，以原 run 的可信清理凭证确认释放；回执中断后仅重送原回执。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/run.test.mjs scripts/standalone-skill/worker.test.mjs
- [ ] Notion 建单仅由指定直执行宿主领取，旧 Commander 入口无法领取。真实隔离 PG 验证领取、固定启动、原单结算。
  Test: manual:cd packages/brain && npx --no-install vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-foundation.pg.integration.test.js
- [ ] 独立适配器使用现有手机运行时发布证据固定本轮，先登记起跑再启动工具，业务入库只以工具独立读回确认。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/standalone-skill/native-discovery.test.mjs
- [ ] 四条获客 Workflow 的 Notion 标记分别处理。未登记执行端的 102～104 回写原页，避免通用 Agent 误接。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/notion-push-sync-marked-ingest.test.js
