# DoD: 清理 Brain 垃圾派发路径 + 注册 Codex Gate 路由

## 验收标准

- [ ] task-router.js VALID_TASK_TYPES 包含 prd_review / spec_review / code_review_gate / initiative_review
- [ ] task-router.js SKILL_WHITELIST 包含 4 个 Gate 路由
- [ ] task-router.js LOCATION_MAP 包含 4 个 Gate 路由（均为 us）
- [ ] executor.js skillMap 包含 4 个 Gate 类型
- [ ] executor.js US_ONLY_TYPES 包含 4 个 Gate 类型
- [ ] executor.js 新增 initiative_review 命令构建逻辑
- [ ] decomposition-checker.js 删除 hasExistingInitiativePlanTask
- [ ] decomposition-checker.js 删除 createInitiativePlanTask
- [ ] decomposition-checker.js checkReadyKRInitiatives 不再创建 initiative_plan 任务
- [ ] token-budget-planner.js EXECUTOR_AFFINITY 包含 4 个 Gate 类型
- [ ] pre-flight-check.js SYSTEM_TASK_TYPES 包含 4 个 Gate 类型
- [ ] planner.js Area Stream 保留并加注释

## 测试

- [ ] [BEHAVIOR] manual: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');const m=c.match(/LOCATION_MAP\s*=\s*\{[^}]*\}/s);if(!m||!m[0].includes('prd_review'))process.exit(1);console.log('prd_review 路由已注册到 LOCATION_MAP')"
- [ ] [BEHAVIOR] manual: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"'code_review_gate': '/code-review-gate'\"))process.exit(1);console.log('code_review_gate 已注册到 executor skillMap')"
- [ ] [BEHAVIOR] manual: node -e "const c=require('fs').readFileSync('packages/brain/src/decomposition-checker.js','utf8');if(c.includes('async function createInitiativePlanTask'))process.exit(1);console.log('createInitiativePlanTask 已从 decomposition-checker 中删除')"
- [ ] manual: node -e "const c=require('fs').readFileSync('packages/brain/src/token-budget-planner.js','utf8');if(!c.includes('initiative_review'))process.exit(1)"
- [ ] manual: node -e "const c=require('fs').readFileSync('packages/brain/src/pre-flight-check.js','utf8');if(!c.includes('spec_review'))process.exit(1)"
