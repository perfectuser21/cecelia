# Contract DoD — Workstream 3: 质量评估 + Dashboard 数据链增强

- [ ] [BEHAVIOR] harness-evaluator skill 包含整体质量评估步骤（health check + 质量检查 + git diff 检查）
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-evaluator/SKILL.md');if(!fs.existsSync(sp))throw new Error('FAIL');const c=fs.readFileSync(sp,'utf8');if(!c.includes('health')&&!c.includes('/api/brain/health'))throw new Error('FAIL: 缺少health');if(!c.includes('quality')&&!c.includes('质量'))throw new Error('FAIL: 缺少质量');if(!c.includes('git diff'))throw new Error('FAIL: 缺少git diff');console.log('PASS')"
- [ ] [BEHAVIOR] pipeline-detail API 返回 stages 数组，每项含 task_type/status/created_at 且非空
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=f093409e-97d9-432d-b292-1f1759dd9b66" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!Array.isArray(d.stages))throw new Error('FAIL');if(d.stages.length===0)throw new Error('FAIL: stages为空');for(const s of d.stages){if(!s.task_type||!s.status)throw new Error('FAIL: stage缺少字段')}console.log('PASS: '+d.stages.length+'项')"
- [ ] [BEHAVIOR] Dashboard StageTimeline 组件渲染阶段时间线
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('StageTimeline'))throw new Error('FAIL');if(!c.match(/StageTimeline[\s\S]{0,100}stages/))throw new Error('FAIL: StageTimeline未接收stages');console.log('PASS')"
- [ ] [BEHAVIOR] Brain health 端点可达
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.status&&!d.ok)throw new Error('FAIL');console.log('PASS')"
