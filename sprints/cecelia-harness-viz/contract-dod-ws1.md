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

- [ ] [BEHAVIOR] GET /initiative/:id/ws-progress 返回 keys == ["initiative_id","workstreams"]（schema 完整性）
  Test: manual:bash -c 'ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '"'"'{"task_type":"harness_initiative","title":"_test_ws_progress_schema"}'"'"' | jq -r .id); curl -sf "localhost:5221/api/brain/harness/initiative/$ID/ws-progress" | jq -e '"'"'keys == ["initiative_id","workstreams"]'"'"' && echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_id 字段值等于请求路径 id
  Test: manual:bash -c 'ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '"'"'{"task_type":"harness_initiative","title":"_test_ws_progress_id_match"}'"'"' | jq -r .id); curl -sf "localhost:5221/api/brain/harness/initiative/$ID/ws-progress" | jq -e ".initiative_id == \"$ID\"" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 无 WS checkpoint 时 workstreams 返回 []
  Test: manual:bash -c 'ID=$(curl -sf -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d '"'"'{"task_type":"harness_initiative","title":"_test_ws_progress_empty"}'"'"' | jq -r .id); curl -sf "localhost:5221/api/brain/harness/initiative/$ID/ws-progress" | jq -e '"'"'.workstreams == []'"'"' && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 不存在 initiative_id 返回 HTTP 404 + {error:"initiative not found"}
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/ws404.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000099/ws-progress"); [ "$CODE" = "404" ] || { echo "FAIL: expected 404 got $CODE"; exit 1; }; jq -e '"'"'.error == "initiative not found"'"'"' /tmp/ws404.json && echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户访问 /pipeline 页面，在 in_progress initiative card 中看到 WS 进度区块
  Screenshots:
    - 01-initial.png   期望：/pipeline 页面正常加载，页面标题和 pipeline 卡片列表可见
    - 02-ws-progress-visible.png    期望：PipelineCard 内 ws-progress-section 区块可见，每行显示 ws_id + 状态图标
    - 03-result.png    期望：后端 API 交叉验证通过，截图显示最终页面状态
  期望：所有截图与期望描述一致，Claude Read 图自验通过
