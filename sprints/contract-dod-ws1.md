---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Brain SSE 端点 — GET /api/brain/harness/stream

**范围**: 在 `packages/brain/src/routes/harness.js` 新增 `GET /stream` SSE 端点
**大小**: M (100-130 行)
**依赖**: 无（task_events 表已存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] harness.js 新增 `/stream` 路由（含 `router.get('/stream', ...)` 行）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes(\"router.get('/stream'\"))process.exit(1)"

- [ ] [ARTIFACT] SSE 端点读取 `task_events` 表（含 `event_type='graph_node_update'` 过滤条件）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('graph_node_update'))process.exit(1)"

- [ ] [ARTIFACT] 节点中文标签映射对象存在（含 `planner`/`proposer`/`reviewer`/`generator`/`evaluator` 等 key）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/planner.*规划师|proposer.*提案者/s.test(c))process.exit(1)"

- [ ] [ARTIFACT] keepalive comment 实现（含 `: keepalive` 字符串）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes(': keepalive'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] GET /stream?planner_task_id={id} 推送 node_update 事件，data.node 为 string
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
    TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, payload) VALUES ('"'"'harness_dod_b1'"'"', '"'"'completed'"'"', '"'"'{}'"'"'::jsonb) RETURNING id" | tr -d '"'"' \n'"'"')
    psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at) VALUES ('"'"'$TASK_ID'"'"', '"'"'graph_node_update'"'"', '"'"'{"nodeName":"proposer","attemptN":1,"payloadSummary":{}}'"'"'::jsonb, NOW() - interval '"'"'2 seconds'"'"')" >/dev/null
    EVENT_DATA=$(curl -N -s --max-time 6 "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" | grep "^data:" | grep -v "event: done" | head -1 | sed '"'"'s/^data: //'"'"')
    psql "$DB" -c "DELETE FROM task_events WHERE task_id='"'"'$TASK_ID'"'"'; DELETE FROM tasks WHERE id='"'"'$TASK_ID'"'"'" >/dev/null 2>&1 || true
    [ -n "$EVENT_DATA" ] || exit 1
    echo "$EVENT_DATA" | jq -e '"'"'.node | type == "string"'"'"' || exit 1
  '
  期望: exit 0

- [ ] [BEHAVIOR] data.label 为 string（节点中文标签，如"提案者"/"生成器"）
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
    TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, payload) VALUES ('"'"'harness_dod_b2'"'"', '"'"'completed'"'"', '"'"'{}'"'"'::jsonb) RETURNING id" | tr -d '"'"' \n'"'"')
    psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at) VALUES ('"'"'$TASK_ID'"'"', '"'"'graph_node_update'"'"', '"'"'{"nodeName":"generator","attemptN":1,"payloadSummary":{}}'"'"'::jsonb, NOW() - interval '"'"'2 seconds'"'"')" >/dev/null
    EVENT_DATA=$(curl -N -s --max-time 6 "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" | grep "^data:" | grep -v "event: done" | head -1 | sed '"'"'s/^data: //'"'"')
    psql "$DB" -c "DELETE FROM task_events WHERE task_id='"'"'$TASK_ID'"'"'; DELETE FROM tasks WHERE id='"'"'$TASK_ID'"'"'" >/dev/null 2>&1 || true
    [ -n "$EVENT_DATA" ] || exit 1
    echo "$EVENT_DATA" | jq -e '"'"'.label | type == "string"'"'"' || exit 1
    echo "$EVENT_DATA" | jq -e '"'"'.attempt >= 1'"'"' || exit 1
    echo "$EVENT_DATA" | jq -e '"'"'.ts | type == "string"'"'"' || exit 1
  '
  期望: exit 0

- [ ] [BEHAVIOR] response keys 完整性 — 顶层 keys 恰好为 ["attempt","label","node","ts"]
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
    TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, payload) VALUES ('"'"'harness_dod_b3'"'"', '"'"'completed'"'"', '"'"'{}'"'"'::jsonb) RETURNING id" | tr -d '"'"' \n'"'"')
    psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at) VALUES ('"'"'$TASK_ID'"'"', '"'"'graph_node_update'"'"', '"'"'{"nodeName":"evaluator","attemptN":1,"payloadSummary":{}}'"'"'::jsonb, NOW() - interval '"'"'2 seconds'"'"')" >/dev/null
    EVENT_DATA=$(curl -N -s --max-time 6 "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" | grep "^data:" | grep -v "event: done" | head -1 | sed '"'"'s/^data: //'"'"')
    psql "$DB" -c "DELETE FROM task_events WHERE task_id='"'"'$TASK_ID'"'"'; DELETE FROM tasks WHERE id='"'"'$TASK_ID'"'"'" >/dev/null 2>&1 || true
    [ -n "$EVENT_DATA" ] || exit 1
    echo "$EVENT_DATA" | jq -e '"'"'keys == ["attempt","label","node","ts"]'"'"' || exit 1
  '
  期望: exit 0

- [ ] [BEHAVIOR] 禁用字段 nodeName/timestamp/name/type/payload/result 不出现在 data 中
  Test: manual:bash -c '
    DB="${DATABASE_URL:-postgresql://cecelia@localhost/cecelia}"
    TASK_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, payload) VALUES ('"'"'harness_dod_b4'"'"', '"'"'completed'"'"', '"'"'{}'"'"'::jsonb) RETURNING id" | tr -d '"'"' \n'"'"')
    psql "$DB" -c "INSERT INTO task_events (task_id, event_type, payload, created_at) VALUES ('"'"'$TASK_ID'"'"', '"'"'graph_node_update'"'"', '"'"'{"nodeName":"planner","attemptN":1,"payloadSummary":{}}'"'"'::jsonb, NOW() - interval '"'"'2 seconds'"'"')" >/dev/null
    EVENT_DATA=$(curl -N -s --max-time 6 "localhost:5221/api/brain/harness/stream?planner_task_id=$TASK_ID" | grep "^data:" | grep -v "event: done" | head -1 | sed '"'"'s/^data: //'"'"')
    psql "$DB" -c "DELETE FROM task_events WHERE task_id='"'"'$TASK_ID'"'"'; DELETE FROM tasks WHERE id='"'"'$TASK_ID'"'"'" >/dev/null 2>&1 || true
    [ -n "$EVENT_DATA" ] || exit 1
    for BANNED in nodeName name timestamp time step phase stage type payload result event_type; do
      echo "$EVENT_DATA" | jq -e "has(\"$BANNED\") | not" || { echo "FAIL: 禁用字段 $BANNED 出现"; exit 1; }
    done
  '
  期望: exit 0

- [ ] [BEHAVIOR] error path — 缺 planner_task_id → 400，body 含 error key 不含 message
  Test: manual:bash -c '
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/stream")
    [ "$CODE" = "400" ] || { echo "FAIL: 应 400，实返 $CODE"; exit 1; }
    ERR_BODY=$(curl -s "localhost:5221/api/brain/harness/stream")
    echo "$ERR_BODY" | jq -e '"'"'.error | type == "string"'"'"' || { echo "FAIL: error 字段缺失"; exit 1; }
    echo "$ERR_BODY" | jq -e '"'"'has("message") | not'"'"' || { echo "FAIL: 禁用字段 message 出现"; exit 1; }
  '
  期望: exit 0

- [ ] [BEHAVIOR] error path — 未知 planner_task_id → 404，body 含 error key
  Test: manual:bash -c '
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/stream?planner_task_id=00000000-0000-0000-0000-000000000000")
    [ "$CODE" = "404" ] || { echo "FAIL: 未知 ID 应 404，实返 $CODE"; exit 1; }
    ERR_BODY=$(curl -s "localhost:5221/api/brain/harness/stream?planner_task_id=00000000-0000-0000-0000-000000000000")
    echo "$ERR_BODY" | jq -e '"'"'.error | type == "string"'"'"' || { echo "FAIL: error 字段缺失"; exit 1; }
  '
  期望: exit 0
