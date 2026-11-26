# 悦升 102、103 英文 Tasks 独立派单验收

Task: 50988116-377f-4407-bdff-870aceb6ab6a
GP-Anchor: none(infra)

- [ ] 只有英语 Tasks 的 101、显式分阶段批准的 102/103 和管理员来源租户匹配时，才路由到实际公司 UUID。拒绝错误来源、公司、阶段和 104 跨租户派单。
  Test: manual:npm test --workspace packages/brain -- src/__tests__/notion-leadgen-dispatch.test.js
- [ ] 只按目标租户恢复原 Notion 回执，错误父库不能恢复或建单。
  Test: manual:npm test --workspace packages/brain -- src/__tests__/notion-push-sync-marked-ingest.test.js
- [ ] 隔离 PostgreSQL 并发验证同源页只有一个任务，跨目标租户重放拒绝，未启动运行。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
- [ ] Brain 版本同步。
  Test: manual:bash scripts/check-version-sync.sh
