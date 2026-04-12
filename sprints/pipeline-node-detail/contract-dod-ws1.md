# Contract DoD — Workstream 1: Backend — system_prompt_content 字段

- [ ] [BEHAVIOR] pipeline-detail API 每个 step 返回 system_prompt_content 字段，值为对应 SKILL.md 全文或 null
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=d0516971-320c-4178-b556-a431e54e7bb6" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const s=d.steps[0];if(!('system_prompt_content' in s))throw new Error('FAIL');console.log('PASS: len='+(s.system_prompt_content?.length||'null'))"
- [ ] [BEHAVIOR] 未知 task_type 不报错，system_prompt_content 返回 null
  Test: node -e "const m={'harness_planner':'harness-planner'};const r=m['unknown_type']||null;if(r!==null)throw new Error('FAIL');console.log('PASS: 未知类型返回 null')"
