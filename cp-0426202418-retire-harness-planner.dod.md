# DoD: 退役 harness_planner pipeline + cleanup 6 个 stub/runner 文件

- [x] [BEHAVIOR] executor.js: harness_planner task 路由到 _RETIRED_HARNESS_TYPES → terminal_failure
  Test: packages/brain/src/__tests__/executor-harness-planner-retired.test.js

- [x] [BEHAVIOR] harness-shared.js export 3 共享函数（parseDockerOutput / extractField / loadSkillContent）
  Test: packages/brain/src/__tests__/harness-shared.test.js

- [x] [ARTIFACT] 删 harness-graph.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-graph.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-graph-runner.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-graph-runner.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-watcher.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-watcher.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-phase-advancer.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-phase-advancer.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-initiative-runner.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-initiative-runner.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [ARTIFACT] 删 harness-task-dispatch.js
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/brain/src/harness-task-dispatch.js');process.exit(1)}catch(e){process.exit(0)}"

- [x] [BEHAVIOR] task-router.js VALID_TASK_TYPES 不含 harness_planner
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');const m=c.match(/VALID_TASK_TYPES[\s\S]+?\]/);if(!m||m[0].includes(\"'harness_planner'\")||m[0].includes('\"harness_planner\"'))process.exit(1)"

- [x] [BEHAVIOR] routes/goals.js / status.js / harness.js 不再 SQL 查询 harness_planner
  Test: manual:node -e "['routes/goals.js','routes/status.js','routes/harness.js'].forEach(f=>{const c=require('fs').readFileSync('packages/brain/src/'+f,'utf8');if(c.match(/task_type\s*=\s*['\"]harness_planner['\"]/i))process.exit(1)});process.exit(0)"
