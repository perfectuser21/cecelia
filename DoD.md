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

- [ ] [ARTIFACT] harness.js 含 `initiative/:id/ws-progress` 路由定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('ws-progress'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 路由使用 checkpoint_blobs 表查询（含 thread_id LIKE 'harness-task:%:ws%' 过滤）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('checkpoint_blobs'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] ws-progress API 返回顶层 keys 精确等于 ["initiative_id","workstreams"]
- [ ] [BEHAVIOR] initiative_id 字段值等于请求路径中的 id
- [ ] [BEHAVIOR] workstreams 是数组且不包含禁用字段
- [ ] [BEHAVIOR] 无 WS checkpoint 的 initiative 返回 workstreams=[]
- [ ] [BEHAVIOR] 不存在的 initiative_id 返回 HTTP 404 + error 字段
- [ ] [BEHAVIOR] workstream 子对象 fix_round 是 number 类型
