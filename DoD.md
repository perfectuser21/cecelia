# 悦升 101 英文 Tasks 来源租户验收

Task: 523c82b2-27e5-49b6-bd8c-c63280571510
GP-Anchor: none(infra)

- [ ] 只有英语 Tasks 的 101 和显式管理员来源租户匹配才能路由到实际公司 UUID，拒绝错误来源、公司与其他阶段。
  Test: manual:npm test --workspace packages/brain -- src/__tests__/notion-leadgen-dispatch.test.js
- [ ] 只按目标租户恢复原 Notion 回执，错误父库不能恢复或建单。
  Test: manual:npm test --workspace packages/brain -- src/__tests__/notion-push-sync-marked-ingest.test.js
- [ ] 隔离 PostgreSQL 并发验证同源页只有一个任务，跨目标租户重放拒绝，未启动运行。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
- [ ] Brain 版本同步。
  Test: manual:bash scripts/check-version-sync.sh
