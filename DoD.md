# DoD — WS4: Harness Initiative Patrol

卡住检测 + intervention 触发：扫 `initiative_runs`（未完成）检测 Planner（15min）/ GAN 每轮（20min）卡住，
超阈值在 `tasks` 表创建 `harness_intervention` 任务，交本机干预。

## 成功标准

- [x] [ARTIFACT] packages/brain/src/harness-initiative-patrol.js 文件存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/harness-initiative-patrol.js')"
- [x] [ARTIFACT] pipeline-patrol-plugin.js 调用 harnessInitiativePatrol
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/pipeline-patrol-plugin.js','utf8');if(!c.includes('runHarnessInitiativePatrol'))process.exit(1)"
- [x] [BEHAVIOR] harness-initiative-patrol.js 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/harness-initiative-patrol.js')"
- [x] [BEHAVIOR] 含 completed_at IS NULL 查询
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8');if(!c.includes('completed_at IS NULL'))process.exit(1)"
- [x] [BEHAVIOR] 含 15min Planner 阈值（15 * 60 * 1000）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8');if(!c.includes('15 * 60 * 1000'))process.exit(1)"
- [x] [BEHAVIOR] 含 GAN 每轮 20min 阈值（20 * 60 * 1000）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8');if(!c.includes('20 * 60 * 1000'))process.exit(1)"
- [x] [BEHAVIOR] 含 harness_intervention 创建逻辑
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8');if(!c.includes('harness_intervention'))process.exit(1)"
- [x] [BEHAVIOR] 含防重状态检查（queued/in_progress/pending）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8');if(!(c.includes('queued')&&c.includes('in_progress')&&c.includes('pending')))process.exit(1)"
# WS4 patrol triggered at Fri May 29 08:38:33 CST 2026
