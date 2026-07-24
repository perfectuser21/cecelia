contract_branch: cp-07231921-harness-propose-r1-137fea96
sprint_dir: sprints/07240614-relay-137fea96

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: postdeploy-verifier smoke 任务清理机制真正生效

**范围**: `packages/brain/src/routes/task-tasks.js` 新增 `DELETE /:id`（软删除，复用 `TERMINAL_STATUSES` 保护）；`packages/brain/src/postdeploy-verifier.js` 的 `fetchPendingBatch` 排除 `title LIKE 'smoke:%'` 前缀任务
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] `task-tasks.js` 新增 DELETE 路由，复用既有 `TERMINAL_STATUSES` 常量（不新建第二套终态定义）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/task-tasks.js','utf8'); if(!/router\.delete\(['\"]\/:id['\"]/.test(c)) process.exit(1); if(!/TERMINAL_STATUSES/.test(c)) process.exit(1);"

- [x] [ARTIFACT] `postdeploy-verifier.js` 的 `fetchPendingBatch` SQL 含 `smoke:` 前缀排除条件
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/postdeploy-verifier.js','utf8'); const m=c.match(/async function fetchPendingBatch[\s\S]*?\n}/); if(!m || !/NOT LIKE\s+'smoke:%'/.test(m[0])) process.exit(1);"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，target_environment=local_api，真实 Brain + 真实 Postgres）

- [x] [BEHAVIOR] 存在的非终态任务发起 DELETE → HTTP 200，响应体 status=cancelled，且 DB 行 status 真实变为 cancelled（不信任响应体自证，双重校验）
  Test: manual:bash
  ```bash
  set -e
  DB="${DB:-postgresql://localhost/cecelia}"
  TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','dod-b1-delete-ok','{}'::jsonb) RETURNING id" | tr -d ' \n')
  RESP=$(curl -sf -X DELETE "localhost:5221/api/brain/tasks/$TID")
  echo "$RESP" | jq -e '.status == "cancelled"'
  echo "$RESP" | jq -e 'has("id") and has("status")'
  DBSTATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID'" | tr -d ' \n')
  [ "$DBSTATUS" = "cancelled" ]
  echo OK
  ```
  期望: OK（且各处断言均未提前以非零 exit 中断）

- [x] [BEHAVIOR] 不存在的任务 id 发起 DELETE → HTTP 404，响应体含 error 字段 (string) 且 id 字段回显请求的任务 id，不产生任何 DB 变更
  Test: manual:bash
  ```bash
  set -e
  CODE=$(curl -s -o /tmp/dod_del_404.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000099")
  [ "$CODE" = "404" ]
  jq -e '.error | type == "string"' /tmp/dod_del_404.json
  jq -e '.id == "00000000-0000-0000-0000-000000000099"' /tmp/dod_del_404.json
  echo OK
  ```
  期望: OK

- [x] [BEHAVIOR] 已 completed 的任务发起 DELETE → HTTP 409，响应体含 error/details（均为 string），DB 行 status 保持 completed（未被误改，防误删历史记录）
  Test: manual:bash
  ```bash
  set -e
  DB="${DB:-postgresql://localhost/cecelia}"
  TID2=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','completed','dod-b3-delete-terminal','{}'::jsonb) RETURNING id" | tr -d ' \n')
  CODE=$(curl -s -o /tmp/dod_del_409_completed.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID2")
  [ "$CODE" = "409" ]
  jq -e '.error | type == "string"' /tmp/dod_del_409_completed.json
  jq -e '.details | type == "string"' /tmp/dod_del_409_completed.json
  DBSTATUS2=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID2'" | tr -d ' \n')
  [ "$DBSTATUS2" = "completed" ]
  psql "$DB" -c "DELETE FROM tasks WHERE id='$TID2'" >/dev/null
  echo OK
  ```
  期望: OK

- [x] [BEHAVIOR] 已 cancelled 的任务再次发起 DELETE → HTTP 409，响应体含 error/details（均为 string）（幂等边界，TERMINAL_STATUSES 同时覆盖 completed 与 cancelled）
  Test: manual:bash
  ```bash
  set -e
  DB="${DB:-postgresql://localhost/cecelia}"
  TID3=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','cancelled','dod-b4-delete-already-cancelled','{}'::jsonb) RETURNING id" | tr -d ' \n')
  CODE=$(curl -s -o /tmp/dod_del_409_cancelled.json -w "%{http_code}" -X DELETE "localhost:5221/api/brain/tasks/$TID3")
  [ "$CODE" = "409" ]
  jq -e '.error | type == "string"' /tmp/dod_del_409_cancelled.json
  jq -e '.details | type == "string"' /tmp/dod_del_409_cancelled.json
  psql "$DB" -c "DELETE FROM tasks WHERE id='$TID3'" >/dev/null
  echo OK
  ```
  期望: OK

- [x] [BEHAVIOR] title 以 "smoke:" 开头的 pending_postdeploy 任务 → 真实调用 runPostdeployVerifier() 扫描后，status 仍为 pending_postdeploy（未被消费/未标 completed/failed，payload 无 postdeploy_retry_count 写入）
  Test: manual:bash
  ```bash
  set -e
  DB="${DB:-postgresql://localhost/cecelia}"
  SMOKE_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','smoke: dod-b5-filter-test', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')
  node --input-type=module -e "
  import { runPostdeployVerifier, _resetThrottleForTest } from '$(pwd)/packages/brain/src/postdeploy-verifier.js';
  import pg from 'pg';
  const client = new pg.Client(process.env.DB || 'postgresql://localhost/cecelia');
  await client.connect();
  _resetThrottleForTest();
  await runPostdeployVerifier(client);
  await client.end();
  "
  SMOKE_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$SMOKE_TID'" | tr -d ' \n')
  [ "$SMOKE_STATUS" = "pending_postdeploy" ]
  RETRYCOUNT=$(psql "$DB" -tAq -c "SELECT payload->>'postdeploy_retry_count' FROM tasks WHERE id='$SMOKE_TID'" | tr -d ' \n')
  [ -z "$RETRYCOUNT" ]
  psql "$DB" -c "DELETE FROM tasks WHERE id='$SMOKE_TID'" >/dev/null
  echo OK
  ```
  期望: OK

- [x] [BEHAVIOR] 对照：不带 smoke: 前缀的同批次任务 → 正常被 runPostdeployVerifier() 消费，status 变为 completed（证明过滤是选择性排除，未打坏整个批次消费机制）
  Test: manual:bash
  ```bash
  set -e
  DB="${DB:-postgresql://localhost/cecelia}"
  CONTROL_TID=$(psql "$DB" -tAq -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('dev','pending_postdeploy','dod-b6-filter-control', jsonb_build_object('postdeploy_check', jsonb_build_object('command','sh -c \"echo ok\"','timeout_s',5))) RETURNING id" | tr -d ' \n')
  node --input-type=module -e "
  import { runPostdeployVerifier, _resetThrottleForTest } from '$(pwd)/packages/brain/src/postdeploy-verifier.js';
  import pg from 'pg';
  const client = new pg.Client(process.env.DB || 'postgresql://localhost/cecelia');
  await client.connect();
  _resetThrottleForTest();
  await runPostdeployVerifier(client);
  await client.end();
  "
  CONTROL_STATUS=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$CONTROL_TID'" | tr -d ' \n')
  [ "$CONTROL_STATUS" = "completed" ]
  psql "$DB" -c "DELETE FROM tasks WHERE id='$CONTROL_TID'" >/dev/null
  echo OK
  ```
  期望: OK

- [x] [BEHAVIOR] postdeploy-verifier-smoke.sh 全脚本回归 — Step 3 清理命中新 DELETE 路由（200），脚本创建的任务最终 DB status='cancelled'（PRD 背景段描述的根因链路已断开）
  Test: manual:bash
  ```bash
  set -e
  DB="${DB:-postgresql://localhost/cecelia}"
  OUT=$(BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/postdeploy-verifier-smoke.sh 2>&1)
  echo "$OUT"
  TID4=$(echo "$OUT" | grep -oE 'id=[0-9a-f-]{36}' | head -1 | cut -d= -f2)
  [ -n "$TID4" ]
  DBSTATUS4=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID4'" | tr -d ' \n')
  [ "$DBSTATUS4" = "cancelled" ]
  echo OK
  ```
  期望: OK
