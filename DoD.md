# DoD — WS5 Intervention Handler

Brain harness pipeline 卡住时的人工干预处理器：读 Docker logs → LLM 分析 → 输出 retry/skip/alert。

## 成功标准

- [x] [ARTIFACT] packages/brain/src/harness-intervention-handler.js 文件存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/harness-intervention-handler.js')"

- [x] [ARTIFACT] task-router.js 引入 harness-intervention-handler
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes('harness-intervention-handler'))process.exit(1)"

- [x] [BEHAVIOR] harness-intervention-handler.js 导出 handleIntervention
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-intervention-handler.js','utf8');if(!c.includes('export async function handleIntervention'))process.exit(1)"

- [x] [BEHAVIOR] 含 action 枚举值（retry/skip/alert）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-intervention-handler.js','utf8');if(!(c.includes('retry')&&c.includes('skip')&&c.includes('alert')))process.exit(1)"

- [x] [BEHAVIOR] task-router.js 注册 harness-intervention-handler
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!(c.includes('INTERNAL_TASK_HANDLERS')&&c.includes('getInternalTaskHandler')))process.exit(1)"

- [x] [BEHAVIOR] 含 Docker logs 读取（docker logs / execSync / execFile）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-intervention-handler.js','utf8');if(!(c.includes('execFile')&&c.includes('logs')))process.exit(1)"

- [x] [BEHAVIOR] 含 try-catch 错误处理（tick 内联不可崩溃）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-intervention-handler.js','utf8');if(!(c.includes('try {')&&c.includes('catch (')))process.exit(1)"

## 测试

单元测试：packages/brain/src/__tests__/harness-intervention-handler.test.js（20 个用例全部通过）
- parseInterventionAction：ACTION 标记 / 裸词 / 降级 alert
- readDockerLogs：成功合并 stdout+stderr / 报错 reject
- handleIntervention：无容器 / 读日志成功 / 读日志失败 / 空日志 / LLM 异常 / 写库异常 全分支降级
- task-router：getInternalTaskHandler 注册查询
# WS5 intervention triggered at Fri May 29 08:38:37 CST 2026
