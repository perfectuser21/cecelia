---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration — initiative_run_events 表

**范围**: 创建 `packages/brain/migrations/276_initiative_run_events.sql`，DDL 严格按 PRD schema
**大小**: S（<35 行，1 文件）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/migrations/276_initiative_run_events.sql` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/migrations/276_initiative_run_events.sql')"

- [ ] [ARTIFACT] migration 文件包含 `CREATE TABLE initiative_run_events` DDL
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/276_initiative_run_events.sql','utf8');if(!c.includes('CREATE TABLE initiative_run_events'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件包含 PRD DDL 所有必填列（id/initiative_id/node/status/created_at）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/276_initiative_run_events.sql','utf8');['id','initiative_id','node','status','created_at'].forEach(col=>{if(!c.includes(col))process.exit(1)})"

- [ ] [ARTIFACT] migration 文件包含复合索引 `(initiative_id, created_at)` 定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/276_initiative_run_events.sql','utf8');if(!c.includes('initiative_id')&&!c.includes('created_at'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] 执行 migration 后 `initiative_run_events` 表存在于 DB
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; RESULT=$(psql "$DB" -t -c "\dt initiative_run_events" 2>/dev/null); echo "$RESULT" | grep -q "initiative_run_events" || { echo "FAIL: 表不存在"; exit 1; }; echo "PASS: 表存在"'
  期望: PASS: 表存在

- [ ] [BEHAVIOR] 表包含全部 PRD 必填列（id/initiative_id/node/status/created_at）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; COLS=$(psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='"'"'initiative_run_events'"'"' ORDER BY column_name" 2>/dev/null); for col in id initiative_id node status created_at; do echo "$COLS" | grep -q "$col" || { echo "FAIL: 缺列 $col"; exit 1; }; done; echo "PASS: 列完整"'
  期望: PASS: 列完整

- [ ] [BEHAVIOR] 有效数据可成功插入（node=planner, status=done）并返回 id
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; RES=$(psql "$DB" -t -c "INSERT INTO initiative_run_events (initiative_id, node, status) VALUES ('"'"'a0000001-0000-0000-0000-000000000001'"'"'::uuid, '"'"'planner'"'"', '"'"'done'"'"') RETURNING id" 2>/dev/null); echo "$RES" | grep -qE "[0-9a-f]{8}-[0-9a-f]{4}" || { echo "FAIL: 插入失败或未返回 uuid id"; exit 1; }; echo "PASS: 插入成功"'
  期望: PASS: 插入成功

- [ ] [BEHAVIOR] error path — initiative_id 为 NULL 触发 NOT NULL 约束拒绝
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; ERR=$(psql "$DB" -c "INSERT INTO initiative_run_events (node, status) VALUES ('"'"'planner'"'"', '"'"'done'"'"')" 2>&1); echo "$ERR" | grep -qi "null value\|not-null\|violates" || { echo "FAIL: NOT NULL 约束未生效"; exit 1; }; echo "PASS: NOT NULL 拒绝 null initiative_id"'
  期望: PASS: NOT NULL 拒绝 null initiative_id

- [ ] [BEHAVIOR] 复合索引 `(initiative_id, created_at)` 存在于 DB
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"; IDX=$(psql "$DB" -t -c "SELECT indexname FROM pg_indexes WHERE tablename='"'"'initiative_run_events'"'"'" 2>/dev/null); [ -n "$IDX" ] || { echo "FAIL: 无任何索引"; exit 1; }; echo "PASS: 索引存在 ($IDX)"'
  期望: PASS: 索引存在
