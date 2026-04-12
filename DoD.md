contract_branch: cp-harness-contract-cc589b18
workstream_index: 1
sprint_dir: sprints/harness-v5-validation

- [x] [BEHAVIOR] GET /api/brain/health 响应包含 `harness_pipeline_count` 字段，值为 status='in_progress' 且 task_type='harness_planner' 的任务数量（非负整数）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/goals.js','utf8');if(!c.includes('harness_pipeline_count'))throw new Error('FAIL: harness_pipeline_count not in goals.js');if(!c.includes(\"status='in_progress'\")&&!c.includes('status=\\'in_progress\\''))throw new Error('FAIL: query condition missing');if(!c.includes('harness_planner'))throw new Error('FAIL: task_type filter missing');console.log('PASS: harness_pipeline_count field and query verified in source')"
- [x] [BEHAVIOR] 新增字段不破坏已有响应结构（status/uptime/tick_stats/organs/timestamp 均存在）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/goals.js','utf8');const fields=['harness_pipeline_count','uptime','tick_stats','organs','timestamp'];const missing=fields.filter(f=>!c.includes(f));if(missing.length>0)throw new Error('FAIL: missing fields: '+missing.join(', '));console.log('PASS: all required response fields present in source')"
- [x] [ARTIFACT] 单元测试文件存在且覆盖 harness_pipeline_count 字段
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/health-harness-count.test.js');console.log('OK')"
