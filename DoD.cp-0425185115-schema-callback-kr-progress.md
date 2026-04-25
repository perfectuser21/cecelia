task_id: 7c90df93-5c79-46d5-91e8-de1efd1870f7
branch: cp-0425185115-schema-callback-kr-progress

## 任务标题
[Harness v6 P1-C] DB schema 补全 callback_queue.retry_count + key_results.progress_pct

## 任务描述

Brain 启动连续报：
- `[health-monitor] callback_queue_stats query failed: column 'retry_count' does not exist`
- `[tick] KR health check failed: column g.progress_pct does not exist`
两个 silently degrade，影响 Layer2Health + KR Verifier 健康面板。

修复：
- 新建 `packages/brain/migrations/245_add_callback_retry_count_kr_progress_pct.sql`，加 `callback_queue.retry_count INTEGER DEFAULT 0` + 部分索引 + `key_results.progress_pct DECIMAL(5,2) DEFAULT 0.0`。
- migration 顶部用 `CREATE TABLE IF NOT EXISTS callback_queue ...` 兜底（生产 cecelia 已有，cecelia_test 不在 migrate 体系内）。
- 新建 `packages/brain/src/__tests__/integration/migration-245.integration.test.js`，CI brain-integration 验证两列与索引落地、health-monitor / kr-verifier 查询能成功执行。

PRD 指定 233_*.sql，但 233_fix_thalamus_provider.sql 已占用，改用下一个可用编号 245。

## DoD

- [x] [ARTIFACT] migration 245 文件存在且含两个 ALTER + 部分索引 + 兜底 CREATE TABLE
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/245_add_callback_retry_count_kr_progress_pct.sql','utf8');if(!c.includes('ADD COLUMN IF NOT EXISTS retry_count')||!c.includes('ADD COLUMN IF NOT EXISTS progress_pct')||!c.includes('idx_callback_queue_retry_count')||!c.includes('CREATE TABLE IF NOT EXISTS callback_queue'))process.exit(1)"

- [x] [ARTIFACT] integration 测试文件存在且断言两列 + 索引存在
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/migration-245.integration.test.js','utf8');if(!c.includes(\"column_name = 'retry_count'\")||!c.includes(\"column_name = 'progress_pct'\")||!c.includes('idx_callback_queue_retry_count'))process.exit(1)"

- [x] [BEHAVIOR] CI brain-integration job 跑 migrate.js 后 integration 测试 5/5 通过
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/migration-245.integration.test.js','utf8');if(!c.includes(\"data_type).toBe('integer')\")||!c.includes(\"data_type).toBe('numeric')\")||!c.includes('SELECT COUNT(*) AS cnt')||!c.includes('FROM key_results'))process.exit(1)"

- [x] [ARTIFACT] Learning 文档存在且含根本原因 + 下次预防
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0425185115-schema-callback-kr-progress.md','utf8');if(!c.includes('根本原因')||!c.includes('下次预防'))process.exit(1)"

## 目标文件

- packages/brain/migrations/245_add_callback_retry_count_kr_progress_pct.sql（新建）
- packages/brain/src/__tests__/integration/migration-245.integration.test.js（新建）
- docs/learnings/cp-0425185115-schema-callback-kr-progress.md（新建）
- docs/superpowers/specs/2026-04-25-schema-callback-kr-progress-design.md（新建）
- docs/superpowers/plans/2026-04-25-schema-callback-kr-progress.md（新建）

## 备注

本地 cecelia + cecelia_test 双 DB 已 apply migration，5/5 integration test 通过。
不改 health-monitor.js / kr-verifier.js（schema 补完后查询自然通）。
