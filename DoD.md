contract_branch: cp-harness-propose-r1-9edb3ff9-a0
sprint_dir: sprints/06162153-harness-health-endpoint-rerun

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness Initiative 健康度端点 `GET /api/brain/harness/initiative/:id/health`

**范围**: 新增只读端点 `GET /api/brain/harness/initiative/:id/health`，挂在 `packages/brain/src/routes/harness.js`（与 `/initiative/:id/detail` 同处）；读 `initiative_runs` + `initiative_run_events` 做健康裁决；返回 7 字段 JSON；400/404 错误处理。无 migration、无写库。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] harness.js 注册 health 端点路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/initiative\/:id\/health/.test(c))process.exit(1)"

- [x] [ARTIFACT] health 端点含 6 态裁决枚举与阈值常量
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!(c.includes('zombie')&&c.includes('no_data')&&c.includes('stuck_minutes')))process.exit(1)"

- [x] [ARTIFACT] 单测文件存在且覆盖 health 端点
  Test: node -e "const c=require('fs').readFileSync('sprints/06162153-harness-health-endpoint-rerun/tests/health-endpoint.test.ts','utf8');if(!c.includes('/initiative/'))process.exit(1)"

## BEHAVIOR 条目（journey_type=autonomous — 测真实 Brain localhost:5221 + psql；每条用受控随机 initiative_id + 用后即删，防历史数据造假）

- [x] [BEHAVIOR] running 健康态：最近事件的进行中 run → state=running、healthy=true、last_node 等于 DB 最新事件 node
  Test: manual:bash -c 'NOW=$(date +%s); IID=$(uuidgen|tr "A-Z" "a-z"); cleanup(){ psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; }; trap cleanup EXIT; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'B_task_loop'"'"')"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$IID'"'"','"'"'generator'"'"','"'"'running'"'"',1,$((NOW-60)))"; R=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); echo "$R" | jq -e ".state==\"running\" and .healthy==true and .last_node==\"generator\" and .stuck_minutes<15" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] stuck 态：prep 反复重试、最后事件 30 分钟前 → state=stuck、last_node=prep、retries==DB(MAX(attempt)-1)、interrupts==DB(failed 计数)、stuck_minutes∈[15,60)
  Test: manual:bash -c 'NOW=$(date +%s); IID=$(uuidgen|tr "A-Z" "a-z"); cleanup(){ psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; }; trap cleanup EXIT; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'B_task_loop'"'"')"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$IID'"'"','"'"'prep'"'"','"'"'failed'"'"',1,$((NOW-2400))),('"'"'$IID'"'"','"'"'prep'"'"','"'"'failed'"'"',2,$((NOW-1800)))"; R=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); echo "$R" | jq -e ".state==\"stuck\" and .last_node==\"prep\" and .retries==1 and .interrupts==2 and .stuck_minutes>=15 and .stuck_minutes<60" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] zombie 态：进行中但最后事件 120 分钟前 → state=zombie、healthy=false、stuck_minutes>=60
  Test: manual:bash -c 'NOW=$(date +%s); IID=$(uuidgen|tr "A-Z" "a-z"); cleanup(){ psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; }; trap cleanup EXIT; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'A_contract'"'"')"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$IID'"'"','"'"'planner'"'"','"'"'running'"'"',1,$((NOW-7200)))"; R=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); echo "$R" | jq -e ".state==\"zombie\" and .healthy==false and .stuck_minutes>=60" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] completed/failed 态：phase=done → state=completed/healthy=true；phase=failed → state=failed/healthy=false
  Test: manual:bash -c 'NOW=$(date +%s); D=$(uuidgen|tr "A-Z" "a-z"); F=$(uuidgen|tr "A-Z" "a-z"); cleanup(){ psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id IN ('"'"'$D'"'"','"'"'$F'"'"')" >/dev/null 2>&1; psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id IN ('"'"'$D'"'"','"'"'$F'"'"')" >/dev/null 2>&1; }; trap cleanup EXIT; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$D'"'"','"'"'done'"'"')"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$D'"'"','"'"'report'"'"','"'"'completed'"'"',1,$((NOW-120)))"; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase,failure_reason) VALUES ('"'"'$F'"'"','"'"'failed'"'"','"'"'eval FAIL'"'"')"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$F'"'"','"'"'evaluator'"'"','"'"'failed'"'"',3,$((NOW-300)))"; RC=$(curl -sf "localhost:5221/api/brain/harness/initiative/$D/health"); echo "$RC" | jq -e ".state==\"completed\" and .healthy==true" || exit 1; RF=$(curl -sf "localhost:5221/api/brain/harness/initiative/$F/health"); echo "$RF" | jq -e ".state==\"failed\" and .healthy==false" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] no_data 边界：initiative_runs 存在但无任何事件 → HTTP 200、state=no_data、last_node=null、retries/interrupts/stuck_minutes 均 0（绝不 500）
  Test: manual:bash -c 'IID=$(uuidgen|tr "A-Z" "a-z"); cleanup(){ psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; }; trap cleanup EXIT; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'A_contract'"'"')"; CODE=$(curl -s -o /tmp/nd.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/$IID/health"); [ "$CODE" = "200" ] || { echo "FAIL code=$CODE"; exit 1; }; jq -e ".state==\"no_data\" and .last_node==null and .retries==0 and .interrupts==0 and .stuck_minutes==0 and (.reason|length>0)" /tmp/nd.json || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] schema 完整性：顶层 keys 排序后完全等于 PRD 7 字段（多/少均 FAIL）
  Test: manual:bash -c 'NOW=$(date +%s); IID=$(uuidgen|tr "A-Z" "a-z"); cleanup(){ psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; }; trap cleanup EXIT; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'B_task_loop'"'"')"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$IID'"'"','"'"'generator'"'"','"'"'running'"'"',1,$((NOW-60)))"; R=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); echo "$R" | jq -e "keys == [\"healthy\",\"interrupts\",\"last_node\",\"reason\",\"retries\",\"state\",\"stuck_minutes\"]" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] 禁用字段反向：响应不得含 status/node/health/message（这些是会漂移的同义词）
  Test: manual:bash -c 'NOW=$(date +%s); IID=$(uuidgen|tr "A-Z" "a-z"); cleanup(){ psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'" >/dev/null 2>&1; }; trap cleanup EXIT; psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('"'"'$IID'"'"','"'"'B_task_loop'"'"')"; psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('"'"'$IID'"'"','"'"'generator'"'"','"'"'running'"'"',1,$((NOW-60)))"; R=$(curl -sf "localhost:5221/api/brain/harness/initiative/$IID/health"); echo "$R" | jq -e "(has(\"status\")|not) and (has(\"node\")|not) and (has(\"health\")|not) and (has(\"message\")|not)" || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] error path：非法 UUID → 400 + error(string)；合法但 initiative_runs 无记录 → 404 + error(string)（两者区分）
  Test: manual:bash -c 'C4=$(curl -s -o /tmp/b4.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/not-a-uuid/health"); [ "$C4" = "400" ] || { echo "FAIL 400 got $C4"; exit 1; }; jq -e ".error|type==\"string\"" /tmp/b4.json || exit 1; C0=$(curl -s -o /tmp/b0.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-0000000000ff/health"); [ "$C0" = "404" ] || { echo "FAIL 404 got $C0"; exit 1; }; jq -e ".error|type==\"string\"" /tmp/b0.json || exit 1; echo OK'
  期望: OK
