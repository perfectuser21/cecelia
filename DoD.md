# DoD: 清理 Brain 垃圾派发路径 + 注册 Codex Gate 路由

## 验收标准

- [ ] [BEHAVIOR] task-router.js VALID_TASK_TYPES 包含 4 个新 Gate 类型
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes(\"'prd_review'\"))process.exit(1);if(!c.includes(\"'spec_review'\"))process.exit(1);if(!c.includes(\"'code_review_gate'\"))process.exit(1);if(!c.includes(\"'initiative_review'\"))process.exit(1)"
- [ ] [BEHAVIOR] task-router.js SKILL_WHITELIST 包含 4 个 Gate 路由
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes(\"'prd_review': '/prd-review'\"))process.exit(1)"
- [ ] [BEHAVIOR] task-router.js LOCATION_MAP 包含 4 个 Gate 路由（均为 us）
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');const m=c.match(/LOCATION_MAP[\\s\\S]*?\\};/);if(!m||!m[0].includes(\"'prd_review': 'us'\"))process.exit(1)"
- [ ] [BEHAVIOR] executor.js skillMap 包含 4 个 Gate 类型
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"'code_review_gate': '/code-review-gate'\"))process.exit(1)"
- [ ] [BEHAVIOR] executor.js US_ONLY_TYPES 包含 4 个 Gate 类型
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"'prd_review'\"))process.exit(1)"
- [ ] [BEHAVIOR] executor.js 新增 initiative_review 命令构建逻辑
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"taskType === 'initiative_review'\"))process.exit(1)"
- [ ] [BEHAVIOR] decomposition-checker.js 删除 hasExistingInitiativePlanTask
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/decomposition-checker.js','utf8');if(c.includes('async function hasExistingInitiativePlanTask'))process.exit(1)"
- [ ] [BEHAVIOR] decomposition-checker.js 删除 createInitiativePlanTask
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/decomposition-checker.js','utf8');if(c.includes('async function createInitiativePlanTask'))process.exit(1)"
- [ ] [BEHAVIOR] decomposition-checker.js checkReadyKRInitiatives 不再创建 initiative_plan 任务
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/decomposition-checker.js','utf8');if(c.includes('create_initiative_plan'))process.exit(1)"
- [ ] [BEHAVIOR] token-budget-planner.js EXECUTOR_AFFINITY 包含 4 个 Gate 类型
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/token-budget-planner.js','utf8');if(!c.includes(\"'initiative_review'\"))process.exit(1)"
- [ ] [BEHAVIOR] pre-flight-check.js SYSTEM_TASK_TYPES 包含 4 个 Gate 类型
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/pre-flight-check.js','utf8');if(!c.includes(\"'spec_review'\"))process.exit(1)"
- [ ] [BEHAVIOR] planner.js Area Stream 保留并加注释说明独立用途
  - Test: manual: node -e "const c=require('fs').readFileSync('packages/brain/src/planner.js','utf8');if(!c.includes('pr_plans 路径互补'))process.exit(1)"
