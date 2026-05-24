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

## BEHAVIOR 条目（manual:node 源码验证，行为逻辑已在 tests/ws1/harness-ws-progress.test.js 覆盖）

- [x] [BEHAVIOR] ws-progress 路由响应结构含 initiative_id 和 workstreams（源码验证）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const fn=c.slice(c.indexOf('ws-progress'),c.indexOf('ws-progress')+3000);if(!fn.includes('initiative_id'))process.exit(1);if(!fn.includes('workstreams'))process.exit(2);console.log('OK')"
  期望: OK

- [x] [BEHAVIOR] ws-progress 路由查询 checkpoint_blobs 并提取 WS 状态字段（源码验证）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const fn=c.slice(c.indexOf('ws-progress'),c.indexOf('ws-progress')+3000);if(!fn.includes('checkpoint_blobs'))process.exit(1);if(!fn.includes('status'))process.exit(2);if(!fn.includes('evaluate_verdict'))process.exit(3);console.log('OK')"
  期望: OK

- [x] [BEHAVIOR] ws-progress 路由含 initiative 存在性校验逻辑并返回 404（源码验证）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const fn=c.slice(c.indexOf('ws-progress'),c.indexOf('ws-progress')+3000);if(!fn.includes('404'))process.exit(1);if(!fn.includes('initiative not found'))process.exit(2);console.log('OK')"
  期望: OK

- [x] [BEHAVIOR] ws-progress 路由 fix_round 转为 number 类型（源码验证）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const fn=c.slice(c.indexOf('ws-progress'),c.indexOf('ws-progress')+3000);if(!fn.includes('fix_round'))process.exit(1);if(!fn.includes('Number('))process.exit(2);console.log('OK')"
  期望: OK

- [x] [BEHAVIOR] 不存在的 initiative_id 返回 HTTP 404 + error 字段（Brain 起后 curl 验证）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/ws404.json -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/ws-progress"); [ "$CODE" = "404" ] || exit 1; node -e "const b=JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'/tmp/ws404.json'"'"'));if(b.error!=='"'"'initiative not found'"'"')process.exit(1)" || exit 1; printf "OK\n"'
  期望: OK
