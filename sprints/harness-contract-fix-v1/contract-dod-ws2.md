# Contract DoD — Workstream 2: Pipeline 状态可视化 API

- [ ] [BEHAVIOR] GET /api/brain/harness/pipeline/:planner_task_id 返回 HTTP 200 + JSON，包含该 pipeline 所有 harness 任务
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length===0)throw new Error('FAIL');console.log('PASS: '+t.length+' tasks')"
- [ ] [BEHAVIOR] 每个节点包含 task_id、task_type、status 三个必填字段
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=(d.tasks||d)[0];['task_id','task_type','status'].forEach(f=>{if(!(f in t))throw new Error('FAIL: missing '+f)});console.log('PASS')"
- [ ] [BEHAVIOR] 不存在的 planner_task_id 返回空数组（不是 404）
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000000" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length!==0)throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 返回的任务按创建时间升序排列
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(t.length<2){console.log('PASS: skip');process.exit(0)}for(let i=1;i<t.length;i++){if(new Date(t[i].created_at||t[i].createdAt)<new Date(t[i-1].created_at||t[i-1].createdAt))throw new Error('FAIL')}console.log('PASS')"
