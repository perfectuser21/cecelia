# DoD — harness_task 默认 P0 + alertness 白名单双保险

Branch: cp-04240815-harness-task-p0

## 验收

- [x] [ARTIFACT] `packages/brain/src/harness-dag.js` 的 `INSERT INTO tasks` 语句默认 priority 为 `'P0'`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-dag.js','utf8');if(!c.includes(\"'queued', 'P0'\"))process.exit(1)"`

- [x] [ARTIFACT] 上述 harness-dag.js 不再含默认 `'P2'` 字面量（回归锚点）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-dag.js','utf8');if(c.includes(\"'queued', 'P2'\"))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/alertness/escalation.js` 的 `pauseLowPriorityTasks` 白名单含 `harness_task`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/alertness/escalation.js','utf8');if(!c.includes(\"'harness_task'\"))process.exit(1)"`

- [x] [ARTIFACT] 上述 escalation.js 白名单含 `harness_initiative`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/alertness/escalation.js','utf8');if(!c.includes(\"'harness_initiative'\"))process.exit(1)"`

- [x] [BEHAVIOR] upsertTaskPlan 新单测验证 INSERT SQL 含 'P0'、不含 'P2'（3 个 case）
  Test: tests/harness-dag-upsert-priority.test.js

- [x] [BEHAVIOR] pauseLowPriorityTasks 新单测验证 UPDATE SQL 白名单覆盖 11 个 harness_* task_type（5 个 case）
  Test: tests/alertness-harness-whitelist.test.js

- [x] [BEHAVIOR] Brain facts-check DevGate 通过
  Test: `manual:node scripts/facts-check.mjs`
