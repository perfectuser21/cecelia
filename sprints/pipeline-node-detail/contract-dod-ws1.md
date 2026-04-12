# Contract DoD — Workstream 1: Backend — system_prompt_content 字段

- [ ] [ARTIFACT] packages/brain/src/routes/harness.js 中 pipeline-detail 端点包含 system_prompt_content 字段读取逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/system_prompt_content/.test(c))throw new Error('FAIL');console.log('OK')"
- [ ] [BEHAVIOR] API 返回的每个 step 的 system_prompt_content 为 string（有 SKILL.md）或 null（无 SKILL.md），调用实际端点验证
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));d.steps.forEach((s,i)=>{if(s.system_prompt_content!==null&&typeof s.system_prompt_content!=='string')throw new Error('FAIL: step '+i)});const w=d.steps.filter(s=>typeof s.system_prompt_content==='string');if(w.length===0)throw new Error('FAIL: 无内容');console.log('PASS: '+w.length+' 个有内容')"
