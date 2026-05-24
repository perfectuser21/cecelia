---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Brain API ws-progress 端点

**范围**: `packages/brain/src/routes/harness.js` 新增 `GET /initiative/:id/ws-progress`，查询 checkpoint_blobs 表读取 WS 进度
**大小**: S (<100 行)
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] harness.js 含 `initiative/:id/ws-progress` 路由定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('ws-progress'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 路由使用 checkpoint_blobs 表查询（含 thread_id LIKE 'harness-task:%:ws%' 过滤）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('checkpoint_blobs'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令，journey_type=user_facing 模式A：API-level）

- [ ] [BEHAVIOR] ws-progress API 返回顶层 keys 精确等于 ["initiative_id","workstreams"]（schema 完整性）
  Test: manual:bash -c 'INIT_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress); echo "$RESP" | jq -e '"'"'keys == ["initiative_id","workstreams"]'"'"' || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_id 字段值等于请求路径中的 id（字段值正确）
  Test: manual:bash -c 'INIT_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress); echo "$RESP" | jq -e --arg id "$INIT_ID" '"'"'.initiative_id == $id'"'"' || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] workstreams 是数组且不包含禁用字段（keys 完整性 + 禁用字段反向检查）
  Test: manual:bash -c 'INIT_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress); echo "$RESP" | jq -e '"'"'.workstreams | type == "array"'"'"' || exit 1; echo "$RESP" | jq -e '"'"'has("steps") | not'"'"' || exit 1; echo "$RESP" | jq -e '"'"'has("phases") | not'"'"' || exit 1; echo "$RESP" | jq -e '"'"'has("stages") | not'"'"' || exit 1; echo "$RESP" | jq -e '"'"'has("result") | not'"'"' || exit 1; echo "$RESP" | jq -e '"'"'has("data") | not'"'"' || exit 1; echo "$RESP" | jq -e '"'"'has("ws_list") | not'"'"' || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 无 WS checkpoint 的 initiative 返回 workstreams=[]（空数组边界）
  Test: manual:bash -c 'NEW_ID=$(psql $DB -t -c "INSERT INTO tasks (task_type,status,title) VALUES ('"'"'harness_initiative'"'"','"'"'queued'"'"','"'"'test-empty-ws-dod'"'"') RETURNING id" | tr -d " "); RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$NEW_ID/ws-progress); psql $DB -c "DELETE FROM tasks WHERE id='"'"'$NEW_ID'"'"'" >/dev/null; echo "$RESP" | jq -e '"'"'.workstreams == []'"'"' || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 不存在的 initiative_id 返回 HTTP 404 + error 字段（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/ws-progress"); [ "$CODE" = "404" ] || exit 1; BODY=$(curl -s "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/ws-progress"); echo "$BODY" | jq -e '"'"'.error == "initiative not found"'"'"' || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] workstream 子对象 fix_round 是 number 类型（字段类型校验）
  Test: manual:bash -c 'INIT_ID=$(psql $DB -t -c "SELECT t.id FROM tasks t INNER JOIN checkpoint_blobs cb ON cb.thread_id LIKE '"'"'harness-task:'"'"' || t.id::text || '"'"':ws%'"'"' WHERE t.task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); [ -z "$INIT_ID" ] && { echo "SKIP: no initiative with checkpoints"; exit 0; }; RESP=$(curl -sf localhost:5221/api/brain/harness/initiative/$INIT_ID/ws-progress); echo "$RESP" | jq -e '"'"'.workstreams[0].fix_round | type == "number"'"'"' || exit 1; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户访问 /pipeline 页面，在 in_progress initiative card 中看到 WS 进度区块
  Screenshots:
    - 01-initial.png   期望：/pipeline 页面正常加载，页面标题和 pipeline 卡片列表可见
    - 02-ws-progress-visible.png    期望：PipelineCard 内 ws-progress-section 区块可见，每行显示 ws_id + 状态图标
    - 03-result.png    期望：后端 API 交叉验证通过，截图显示最终页面状态
  期望：所有截图与期望描述一致，Claude Read 图自验通过
