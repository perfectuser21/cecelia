# Contract DoD — Workstream 2: 持久化 + 历史查询 API

**范围**: 新增 migration `247_preflight_results.sql` + `packages/brain/src/preflight-store.js`（recordPreflightResult / getPreflightHistory）+ 扩展 `packages/brain/src/routes/initiatives.js` 添加 `GET /:id/preflight`
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 247_preflight_results.sql 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/migrations/247_preflight_results.sql')"

- [ ] [ARTIFACT] migration 含 CREATE TABLE preflight_results
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_preflight_results.sql','utf8');if(!/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?preflight_results\b/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration 含 initiative_id NOT NULL 列
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_preflight_results.sql','utf8');if(!/initiative_id[^,;]*NOT\s+NULL/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration 含 verdict NOT NULL 列
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_preflight_results.sql','utf8');if(!/verdict[^,;]*NOT\s+NULL/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration 含 failures jsonb 列且默认 '[]'
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_preflight_results.sql','utf8');if(!/failures\s+jsonb[^,;]*DEFAULT\s+'\[\]'/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration 含 created_at NOT NULL DEFAULT now()
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_preflight_results.sql','utf8');if(!/created_at[^,;]*NOT\s+NULL[^,;]*DEFAULT\s+now\(\)/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration 含 (initiative_id, created_at DESC) 索引
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/247_preflight_results.sql','utf8');if(!/CREATE\s+INDEX[^;]*preflight_results[^;]*\(initiative_id[^)]*created_at\s+DESC\)/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] preflight-store.js 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/preflight-store.js')"

- [ ] [ARTIFACT] preflight-store.js 导出 recordPreflightResult 与 getPreflightHistory
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight-store.js','utf8');if(!/export\s+(async\s+)?function\s+recordPreflightResult\b|export\s*\{[^}]*\brecordPreflightResult\b/.test(c))process.exit(1);if(!/export\s+(async\s+)?function\s+getPreflightHistory\b|export\s*\{[^}]*\bgetPreflightHistory\b/.test(c))process.exit(2)"

- [ ] [ARTIFACT] routes/initiatives.js 注册 GET /:id/preflight 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/initiatives.js','utf8');if(!/router\.get\(\s*['\"]\/:id\/preflight['\"]/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/preflight-store.test.ts`、`tests/ws2/preflight-api.test.ts`，覆盖：
- inserts a row with verdict, failures, initiative_id and created_at
- persists distinct rows for two writes within same second
- returns records in created_at descending order
- respects limit query parameter
- caps limit at 100 even if larger value requested
- returns 404 with error body when initiative does not exist
- returns 200 with empty records array for known initiative with no history
