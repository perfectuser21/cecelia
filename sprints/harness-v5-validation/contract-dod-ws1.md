# Contract DoD — Workstream 1: health 端点添加 harness_pipeline_count 查询

- [ ] [BEHAVIOR] GET /api/brain/health 响应包含 `harness_pipeline_count` 字段，值为 status='in_progress' 且 task_type='harness_planner' 的任务数量（非负整数）
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!('harness_pipeline_count' in h))throw new Error('FAIL');if(typeof h.harness_pipeline_count!=='number'||!Number.isInteger(h.harness_pipeline_count)||h.harness_pipeline_count<0)throw new Error('FAIL');console.log('PASS: '+h.harness_pipeline_count)"
- [ ] [BEHAVIOR] 新增字段不破坏已有响应结构（status/uptime/tick_stats/organs/timestamp 均存在）
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));['status','uptime','tick_stats','organs','timestamp','harness_pipeline_count'].forEach(k=>{if(!(k in h))throw new Error('FAIL: missing '+k)});console.log('PASS')"
- [ ] [ARTIFACT] 单元测试文件存在且覆盖 harness_pipeline_count 字段
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/health-harness-count.test.js');console.log('OK')"
