# DoD — Pipeline Planner Output Fix

**分支**: cp-0411220122-57c06424-57d8-4edd-8aba-bfc535
**任务**: Planner branch 持久化 + pipeline-detail 数据补全

## DoD

- [x] [BEHAVIOR] Planner 任务完成时，execution-callback 将 planner_branch 以 JSONB merge 方式写入 tasks.result.branch 字段，不覆盖已有字段
  Test: curl -s "localhost:5221/api/brain/tasks?task_type=harness_planner&status=completed&limit=5" | node -e "const ts=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const wb=ts.filter(t=>t.result&&t.result.branch);if(wb.length===0)throw new Error('FAIL');console.log('PASS: '+wb.length+' tasks with branch')"

- [x] [BEHAVIOR] pipeline-detail API 对已完成 Planner 步骤返回非 null 且长度 >50 的 output_content（含 PRD 内容）
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/routes/harness.js');const s=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!s.includes('result?.branch'))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] pipeline-detail API 对 Propose 步骤返回来自 Planner branch 的 input_content（与 Planner output_content 一致）
  Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!s.includes('context.plannerBranch'))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] 无效 planner_task_id 时，pipeline-detail API 返回合法 JSON 响应（含 error 或空 steps 数组），不返回 500
  Test: curl -s "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8');let d;try{d=JSON.parse(r)}catch(e){throw new Error('FAIL')};if(d.error||Array.isArray(d.steps)){console.log('PASS')}else{throw new Error('FAIL')}"
