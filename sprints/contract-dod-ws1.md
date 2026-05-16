---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration — initiative_run_events 表

**范围**: 创建 `packages/brain/src/db/migrations/010-initiative-run-events.sql`，建表 DDL + 复合索引
**大小**: S（<30 行，1 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/db/migrations/010-initiative-run-events.sql` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/db/migrations/010-initiative-run-events.sql')"

- [ ] [ARTIFACT] migration 文件包含 `CREATE TABLE initiative_run_events` DDL
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/db/migrations/010-initiative-run-events.sql','utf8');if(!c.includes('CREATE TABLE initiative_run_events'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件包含 `event_id UUID PRIMARY KEY` 定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/db/migrations/010-initiative-run-events.sql','utf8');if(!c.includes('event_id') || !c.includes('UUID PRIMARY KEY'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件包含复合索引 `(initiative_id, created_at)`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/db/migrations/010-initiative-run-events.sql','utf8');if(!c.includes('initiative_id') || !c.includes('created_at'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] 执行 migration 后 `initiative_run_events` 表存在于 DB
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; RESULT=$(psql "$DB" -t -c "\dt initiative_run_events" 2>/dev/null); echo "$RESULT" | grep -q "initiative_run_events" || { echo "FAIL: 表不存在"; exit 1; }; echo "PASS: 表存在"'
  期望: PASS: 表存在

- [ ] [BEHAVIOR] 表包含全部必填列（event_id/initiative_id/node/status/payload/created_at）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; COLS=$(psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='"'"'initiative_run_events'"'"' ORDER BY column_name" 2>/dev/null); for col in event_id initiative_id node status payload created_at; do echo "$COLS" | grep -q "$col" || { echo "FAIL: 缺列 $col"; exit 1; }; done; echo "PASS: 列完整"'
  期望: PASS: 列完整

- [ ] [BEHAVIOR] node CHECK 约束拒绝无效枚举值（如 'step'）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status) VALUES ('"'"'00000000-0000-0000-0000-000000000000'"'"', '"'"'step'"'"', '"'"'running'"'"')" 2>&1 | grep -qi "violates check constraint" || { echo "FAIL: CHECK 约束未生效"; exit 1; }; echo "PASS: CHECK 约束拒绝非法 node"'
  期望: PASS: CHECK 约束拒绝非法 node

- [ ] [BEHAVIOR] status CHECK 约束拒绝禁用别名（如 'in_progress'）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id, node, status) VALUES ('"'"'00000000-0000-0000-0000-000000000000'"'"', '"'"'planner'"'"', '"'"'in_progress'"'"')" 2>&1 | grep -qi "violates check constraint" || { echo "FAIL: CHECK 约束未拒绝 in_progress"; exit 1; }; echo "PASS: status CHECK 约束正常"'
  期望: PASS: status CHECK 约束正常

- [ ] [BEHAVIOR] 复合索引 `(initiative_id, created_at)` 存在于 DB
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; IDX=$(psql "$DB" -t -c "SELECT indexname FROM pg_indexes WHERE tablename='"'"'initiative_run_events'"'"'" 2>/dev/null); echo "$IDX" | grep -q "initiative_run_events" || { echo "FAIL: 索引不存在"; exit 1; }; echo "PASS: 索引存在"'
  期望: PASS: 索引存在
