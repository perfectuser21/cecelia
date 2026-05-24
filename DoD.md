contract_branch: cp-harness-propose-r3-fb5c3fe5
workstream_index: 1
sprint_dir: sprints/cecelia-harness-viz

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Brain API ws-progress 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /initiative/:id/ws-progress`，查询 checkpoint_blobs 表读取 WS 进度
**大小**: S (<100 行)
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] harness.js 含 `initiative/:id/ws-progress` 路由定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('ws-progress'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 路由使用 checkpoint_blobs 表查询（含 thread_id LIKE 'harness-task:%:ws%' 过滤）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('checkpoint_blobs'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（manual:bash 真环境验证，psql 使用 $DB_HOST/$DB_USER/$DB_PASSWORD/$DB_NAME 单独变量）

- [x] [BEHAVIOR] ws-progress API 返回顶层 keys 精确等于 ["initiative_id","workstreams"]（schema 完整性）
  Test: manual:bash -c 'INIT_ID=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); [ -z "$INIT_ID" ] && { echo "SKIP: no harness_initiative data in test DB"; exit 0; }; RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress); echo "$RESP" | jq -e '"'"'keys == ["initiative_id","workstreams"]'"'"' || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] initiative_id 字段值等于请求路径中的 id（字段值正确）
  Test: manual:bash -c 'INIT_ID=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); [ -z "$INIT_ID" ] && { echo "SKIP: no harness_initiative data in test DB"; exit 0; }; RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress); echo "$RESP" | jq -e --arg id "$INIT_ID" '"'"'.initiative_id == $id'"'"' || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] workstreams 是数组且不包含禁用字段（keys 完整性 + 禁用字段反向检查）
  Test: manual:bash -c 'INIT_ID=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); [ -z "$INIT_ID" ] && { echo "SKIP: no harness_initiative data in test DB"; exit 0; }; RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress); echo "$RESP" | jq -e '"'"'.workstreams | type == "array"'"'"' || exit 1; for f in steps phases stages result data ws_list; do echo "$RESP" | jq -e "has(\"$f\") | not" || exit 1; done; echo OK'
  期望: OK

- [x] [BEHAVIOR] 无 WS checkpoint 的 initiative 返回 workstreams=[]（空数组边界）
  Test: manual:bash -c 'NEW_ID=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "INSERT INTO tasks (task_type,status,title) VALUES ('"'"'harness_initiative'"'"','"'"'queued'"'"','"'"'test-empty-ws-dod'"'"') RETURNING id" | tr -d " "); RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$NEW_ID/ws-progress); PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "DELETE FROM tasks WHERE id='"'"'$NEW_ID'"'"'" >/dev/null; echo "$RESP" | jq -e '"'"'.workstreams == []'"'"' || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] 不存在的 initiative_id 返回 HTTP 404 + error 字段（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/ws-progress"); [ "$CODE" = "404" ] || exit 1; BODY=$(curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/ws-progress"); echo "$BODY" | jq -e '"'"'.error == "initiative not found"'"'"' || exit 1; echo OK'
  期望: OK

- [x] [BEHAVIOR] workstream 子对象 fix_round 是 number 类型（字段类型校验）
  Test: manual:bash -c 'INIT_ID=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT t.id FROM tasks t INNER JOIN checkpoint_blobs cb ON cb.thread_id LIKE '"'"'harness-task:'"'"' || t.id::text || '"'"':ws%'"'"' WHERE t.task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); [ -z "$INIT_ID" ] && { echo "SKIP: no initiative with checkpoints"; exit 0; }; RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress); echo "$RESP" | jq -e '"'"'.workstreams[0].fix_round | type == "number"'"'"' || exit 1; echo OK'
  期望: OK
