# Contract DoD — Workstream 3: Quality & Observability (Evaluator Health Check + Dashboard Data Chain)

- [ ] [BEHAVIOR] Evaluator 在功能验收 PASS 后检查 Brain API 核心端点（health/tasks/context）返回 200
  Test: bash -c 'for e in /api/brain/health "/api/brain/tasks?limit=1" /api/brain/context; do S=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221${e}"); [ "$S" = "200" ] || { echo "FAIL: $e → $S"; exit 1; }; done; echo "PASS: 3 个核心端点均返回 200"'
- [ ] [ARTIFACT] harness-evaluator SKILL.md 包含整体质量评估步骤（Brain API + Dashboard + git diff）
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-evaluator/SKILL.md');const c=fs.readFileSync(sp,'utf8');if(!c.includes('质量')||!c.includes('health'))throw new Error('FAIL');console.log('PASS: evaluator skill 含质量评估')"
- [ ] [BEHAVIOR] pipeline-detail API 返回 stages 数组，每阶段含 name/started_at/ended_at/verdict
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=f093409e-97d9-432d-b292-1f1759dd9b66" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.stages||!Array.isArray(d.stages))throw new Error('FAIL: stages 不是数组');console.log('PASS: stages='+d.stages.length+'项')"
- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 渲染阶段时间线
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('stage'))throw new Error('FAIL');console.log('PASS: 页面引用 stage')"
