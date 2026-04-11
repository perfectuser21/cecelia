# Contract DoD — Workstream 2: Pipeline 可视化 API

- [ ] [BEHAVIOR] `GET /api/brain/harness/pipeline/:planner_task_id` 端点存在并返回 HTTP 200 + JSON
  Test: bash -c "STATUS=$(curl -s -o /dev/null -w '%{http_code}' 'localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c'); [ \"$STATUS\" = '200' ] && echo PASS || (echo FAIL: $STATUS; exit 1)"
- [ ] [BEHAVIOR] 返回数组中每个节点包含 task_id、task_type、status 字段
  Test: bash -c "curl -sf 'localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c' | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length===0)throw new Error('FAIL: empty');for(const f of['task_id','task_type','status']){if(!(f in t[0]))throw new Error('FAIL: missing '+f)}console.log('PASS: '+t.length+' nodes')\""
- [ ] [BEHAVIOR] 不存在的 planner_task_id 返回空 tasks 数组
  Test: bash -c "curl -sf 'localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000000' | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length!==0)throw new Error('FAIL');console.log('PASS')\""
