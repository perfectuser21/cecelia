# Contract DoD — Workstream 1: 预检结果存储 schema

**范围**: 仅新增 migration 文件 `packages/brain/migrations/247_initiative_preflight_results.sql`。不改 `initiatives` / `tasks` 表的核心列。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在于 `packages/brain/migrations/247_initiative_preflight_results.sql`
  Test: node -e "const fs=require('fs');fs.accessSync('packages/brain/migrations/247_initiative_preflight_results.sql')"

- [ ] [ARTIFACT] migration SQL 含 `CREATE TABLE IF NOT EXISTS initiative_preflight_results`（idempotent guard）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_initiative_preflight_results.sql','utf8');if(!/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+initiative_preflight_results/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration SQL 声明 `initiative_id` 列
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_initiative_preflight_results.sql','utf8');if(!/initiative_id/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration SQL 声明 `status` 列
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_initiative_preflight_results.sql','utf8');if(!/\bstatus\b/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration SQL 声明 `reasons` 列
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_initiative_preflight_results.sql','utf8');if(!/\breasons\b/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration SQL 声明 `checked_at` 列
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_initiative_preflight_results.sql','utf8');if(!/checked_at/i.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/migration.test.ts`，覆盖：
- migration applies cleanly to empty schema and creates initiative_preflight_results table with required columns
- migration is idempotent — applying twice does not throw
