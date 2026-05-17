---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration — initiative_run_events 表

**范围**: 新建 `initiative_run_events` 表 migration 文件；执行后表和 (initiative_id, ts) 索引存在
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在于 packages/brain/migrations/ 且含 CREATE TABLE initiative_run_events
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations/');const f=files.find(x=>x.includes('initiative_run_events'));if(!f)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+f,'utf8');if(!c.includes('CREATE TABLE initiative_run_events'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件含 initiative_id UUID NOT NULL 字段定义
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations/');const f=files.find(x=>x.includes('initiative_run_events'));if(!f)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+f,'utf8');if(!c.includes('initiative_id'))process.exit(1)"

- [ ] [ARTIFACT] migration 文件含 CREATE INDEX 语句且涵盖 initiative_id 和 ts 字段
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('packages/brain/migrations/');const f=files.find(x=>x.includes('initiative_run_events'));if(!f)process.exit(1);const c=fs.readFileSync('packages/brain/migrations/'+f,'utf8');if(!c.includes('INDEX') || !c.includes('initiative_id'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] 执行 migration 后 initiative_run_events 表存在且含 node 列
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -c "\d initiative_run_events" 2>&1 | grep -q "node" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_run_events 表含所有必需列：node/label/attempt/ts/status/verdict
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; COLS=$(psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='"'"'initiative_run_events'"'"' ORDER BY ordinal_position"); echo "$COLS" | grep -q "node" && echo "$COLS" | grep -q "label" && echo "$COLS" | grep -q "attempt" && echo "$COLS" | grep -q "status" && echo "$COLS" | grep -q "verdict" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_run_events 允许插入 node_update 行并返回自增 id
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; RES=$(psql "$DB" -t -c "INSERT INTO initiative_run_events (initiative_id, node, label, attempt) VALUES ('"'"'aaaaaaaa-bbbb-cccc-dddd-ee0000000001'"'"', '"'"'proposer'"'"', '"'"'Proposer'"'"', 1) RETURNING id" 2>&1 | tr -d " "); echo "$RES" | grep -qE "^[0-9]+" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] (initiative_id, ts) 复合索引存在于 initiative_run_events
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; psql "$DB" -t -c "SELECT indexname FROM pg_indexes WHERE tablename='"'"'initiative_run_events'"'"'" 2>&1 | grep -q "initiative_run_events" && echo OK'
  期望: OK
