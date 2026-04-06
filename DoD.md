# DoD: Harness Pipeline 防误杀

## [ARTIFACT] escalation.js cancelPendingTasks 白名单
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/alertness/escalation.js','utf8');if(!c.includes(\"'sprint_generate'\"))process.exit(1);if(!c.includes(\"'sprint_evaluate'\"))process.exit(1);if(!c.includes(\"'sprint_fix'\"))process.exit(1);console.log('PASS')"`
- [x] sprint_generate/sprint_evaluate/sprint_fix/arch_review 在 cancelPendingTasks NOT IN 白名单

## [ARTIFACT] escalation.js pauseLowPriorityTasks 白名单
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/alertness/escalation.js','utf8');const idx=c.indexOf('async function pauseLowPriorityTasks');const chunk=c.slice(idx,idx+600);if(!chunk.includes('sprint_generate'))process.exit(1);console.log('PASS')"`
- [x] pauseLowPriorityTasks SQL 含 Harness 类型过滤

## [ARTIFACT] alertness index.js 健康升级 guard
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/alertness/index.js','utf8');if(!c.includes('patterns?.length === 0'))process.exit(1);console.log('PASS')"`
- [x] 无 pattern 时 targetLevel 不超过 AWARE(2)

## [ARTIFACT] task-cleanup.js PROTECTED_TASK_TYPES
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-cleanup.js','utf8');if(!c.includes(\"'sprint_generate'\"))process.exit(1);if(!c.includes(\"'sprint_fix'\"))process.exit(1);console.log('PASS')"`
- [x] 所有 Harness 类型在 PROTECTED_TASK_TYPES

## [BEHAVIOR] monitor-loop.js 对 Harness 任务宽限期
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/monitor-loop.js','utf8');if(!c.includes('HARNESS_STUCK_THRESHOLD_MINUTES')||!c.includes('sprint_generate'))process.exit(1);console.log('PASS')"`
- [x] Harness 任务类型有独立 stuck 检测阈值（30 分钟）防止 5 分钟误判

## [ARTIFACT] sprint-evaluator SKILL.md evaluation.md 持久化
- Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-evaluator/SKILL.md','utf8');if(!c.includes('git add')&&!c.includes('git commit'))process.exit(1);console.log('PASS')"`
- [x] SKILL.md 含 git commit + push evaluation.md 步骤
