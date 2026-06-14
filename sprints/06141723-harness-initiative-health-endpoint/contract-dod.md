---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness Initiative 健康度只读端点 GET /api/brain/harness/initiative/:id/health

**范围**: 在 `packages/brain/src/routes/harness.js` 新增只读端点 `/initiative/:id/health`，基于 `initiative_runs` + `initiative_run_events` 裁决健康态。纯只读，无 migration、无写操作。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] harness.js 含 /initiative/:id/health 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('/initiative/:id/health'))process.exit(1)"

- [ ] [ARTIFACT] 测试文件存在（落在 brain-unit CI lane）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-initiative-health.test.ts')"

## BEHAVIOR 条目（autonomous — 测真实 Brain localhost:5221 + psql，全部 seed→断言→cleanup）

- [ ] [BEHAVIOR] 健康在跑的 run（新鲜 event）→ 200，state=healthy / healthy=true / last_node=prep
  Test: manual:bash -c 'IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()"); psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'B_task_loop'"'"')"; NOW=$(date +%s); psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$IID'"'"','"'"'prep'"'"','"'"'running'"'"',1,$NOW)"; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"'; DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'"; echo "$RESP" | jq -e ".healthy==true and .state==\"healthy\" and .last_node==\"prep\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 卡在 prep 反复重试（最近活动 15 分钟前）→ state=stuck，retries=2，interrupts=2，stuck_minutes>=10
  Test: manual:bash -c 'IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()"); psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'B_task_loop'"'"')"; OLD=$(( $(date +%s) - 900 )); psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$IID'"'"','"'"'prep'"'"','"'"'failed'"'"',1,$((OLD-100))),('"'"'$IID'"'"','"'"'prep'"'"','"'"'failed'"'"',2,$((OLD-50))),('"'"'$IID'"'"','"'"'prep'"'"','"'"'running'"'"',3,$OLD)"; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"'; DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'"; echo "$RESP" | jq -e ".state==\"stuck\" and .healthy==false and .last_node==\"prep\" and .retries==2 and .interrupts==2 and .stuck_minutes>=10" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 终态 run — phase=failed → state=failed / healthy=false
  Test: manual:bash -c 'IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()"); psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'failed'"'"')"; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'"; echo "$RESP" | jq -e ".state==\"failed\" and .healthy==false" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应 schema 键完整（恰好 8 键，无多无少）
  Test: manual:bash -c 'IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()"); psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'done'"'"')"; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'"; echo "$RESP" | jq -e "keys == [\"healthy\",\"initiative_id\",\"interrupts\",\"last_node\",\"reason\",\"retries\",\"state\",\"stuck_minutes\"]" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段反向 — 响应不得出现 status/phase/node/health 键
  Test: manual:bash -c 'IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()"); psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'done'"'"')"; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'"; echo "$RESP" | jq -e "(has(\"status\") or has(\"phase\") or has(\"node\") or has(\"health\")) | not" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 非法 UUID → 400 带 error 字符串
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/not-a-uuid/health"); [ "$CODE" = "400" ] || { echo "FAIL code=$CODE"; exit 1; }; curl -s "localhost:5221/api/brain/harness/initiative/not-a-uuid/health" | jq -e ".error | type == \"string\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 合法但不存在的 UUID → 404 带 error 字符串
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-4000-8000-000000000000/health"); [ "$CODE" = "404" ] || { echo "FAIL code=$CODE"; exit 1; }; curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-4000-8000-000000000000/health" | jq -e ".error | type == \"string\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] PRD 边界 — 同一 initiative 多 run 取 created_at 最新一条（旧 failed + 新 B_task_loop → state≠failed）
  Test: manual:bash -c 'IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()"); psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase,created_at) VALUES ('"'"'$IID'"'"','"'"'failed'"'"',NOW()-interval '"'"'1 hour'"'"'),('"'"'$IID'"'"','"'"'B_task_loop'"'"',NOW())"; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'"; echo "$RESP" | jq -e ".state != \"failed\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] PRD 边界 — 有 run 无 event → retries/interrupts=0、last_node=null，不报错
  Test: manual:bash -c 'IID=$(psql "$DB" -t -A -c "SELECT gen_random_uuid()"); psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'B_task_loop'"'"')"; RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'"; echo "$RESP" | jq -e ".retries==0 and .interrupts==0 and .last_node==null" || exit 1; echo OK'
  期望: OK
