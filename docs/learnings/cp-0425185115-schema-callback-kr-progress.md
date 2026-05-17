# cp-0425185115-schema-callback-kr-progress

## 现象
Brain 启动连续报：
- `[health-monitor] callback_queue_stats query failed: column 'retry_count' does not exist`
- `[tick] KR health check failed: column g.progress_pct does not exist`

两个查询都被 try/catch 吞掉（silently degrade），导致 Layer2Health 输出残缺 + KR Verifier 健康面板看不到 progress。

## 根本原因

### 双重 schema 漂移

**漂移 1：`callback_queue.retry_count` 缺列。**
- `health-monitor.js:124` 查 `WHERE retry_count >= 3`，但 `callback_queue` 表只有 `attempt`（来自 `database/migrations/009-callback-queue.sql`）。
- 代码引入 retry_count 字段时未补 ALTER TABLE migration。

**漂移 2：`key_results.progress_pct` 缺列。**
- `kr-verifier.js:126` + `kr3-progress-scheduler.js:46` 查 `g.progress_pct`，但 `key_results` 只有 `progress` (integer) + `current_value` (numeric)，无 `progress_pct`。
- 同上：代码加查询字段，schema 没跟。

### Schema 跨目录撕裂（更深层根因）

`callback_queue` 表本身存在 `database/migrations/009-callback-queue.sql`，但 Brain 的 `src/migrate.js` 只跑 `packages/brain/migrations/*.sql`，两个目录从不互通：
- 生产 cecelia DB 历史上是手动 apply 老脚本建的表，所以"看起来正常"。
- CI cecelia_test DB 走 `node src/migrate.js`，从来没建 `callback_queue` 表，所有 callback_queue 集成测试只能靠 mock。
- 这次必须在 migration 245 顶部用 `CREATE TABLE IF NOT EXISTS callback_queue (...)` 兜底，否则 CI brain-integration 会 ALTER 失败。

## 下次预防

- [ ] 任何 SQL 查询新增列时，PR 必须同时含对应 `ALTER TABLE` migration 文件（grep 该列名在 migrations/ 命中至少一次）。
- [ ] `try/catch` 吞 schema 错的代码段，PR review checklist 加一项："是否含对应 migration"。
- [ ] migration 编号冲突时（PRD 233 已被占）即时改号并在 commit message 注明，不沉默改字段名。
- [ ] 长期：把 `database/migrations/*` 全部迁入 `packages/brain/migrations/` 体系，让 cecelia 与 cecelia_test schema 单一来源；本次 245 顶部的 `CREATE TABLE IF NOT EXISTS callback_queue` 是临时兜底，不是终态。

## 验证记录

- 本地 cecelia + cecelia_test 双 DB apply 245：成功
- `npx vitest run src/__tests__/integration/migration-245.integration.test.js`：5/5 通过
- 模拟 health-monitor.js / kr-verifier.js 查询：均无报错
