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

## BEHAVIOR 条目

- [x] [BEHAVIOR] GET /initiative/:id/ws-progress 返回 keys == ["initiative_id","workstreams"]（schema 完整性）
  Test: manual:bash -c 'ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '"'"'{"task_type":"harness_initiative","title":"_test_ws_progress_schema"}'"'"' | jq -r .id); curl -sf "localhost:5221/api/brain/harness/initiative/$ID/ws-progress" | jq -e '"'"'keys == ["initiative_id","workstreams"]'"'"' && echo OK'
  期望: OK

- [x] [BEHAVIOR] initiative_id 字段值等于请求路径 id
  Test: manual:bash -c 'ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '"'"'{"task_type":"harness_initiative","title":"_test_ws_progress_id_match"}'"'"' | jq -r .id); curl -sf "localhost:5221/api/brain/harness/initiative/$ID/ws-progress" | jq -e ".initiative_id == \"$ID\"" && echo OK'
  期望: OK

- [x] [BEHAVIOR] 无 WS checkpoint 时 workstreams 返回 []
  Test: manual:bash -c 'ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '"'"'{"task_type":"harness_initiative","title":"_test_ws_progress_empty"}'"'"' | jq -r .id); curl -sf "localhost:5221/api/brain/harness/initiative/$ID/ws-progress" | jq -e '"'"'.workstreams == []'"'"' && echo OK'
  期望: OK

- [x] [BEHAVIOR] 不存在 initiative_id 返回 HTTP 404 + {error:"initiative not found"}
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/ws404.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000099/ws-progress"); [ "$CODE" = "404" ] || { echo "FAIL: expected 404 got $CODE"; exit 1; }; jq -e '"'"'.error == "initiative not found"'"'"' /tmp/ws404.json && echo OK'
  期望: OK
