# DoD: Harness Evaluator Mode

## PRD
Brain 需要支持 Evaluator 模式启动：仅提供 HTTP API，跳过所有自动化模块（tick/monitor/probe/scan/self-drive 等）。
同时需要 SKIP_MIGRATIONS 环境变量跳过数据库迁移，以及删除 harness-watcher 的 auto-merge 逻辑（由 Evaluator 接管）。

## 成功标准

- [x] `[ARTIFACT]` server.js 包含 SKIP_MIGRATIONS 环境变量检查，跳过 migration
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('SKIP_MIGRATIONS'))process.exit(1)"`
- [x] `[BEHAVIOR]` BRAIN_EVALUATOR_MODE=true 时 server.listen 回调在自动化模块启动前 return
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!c.includes('BRAIN_EVALUATOR_MODE'))process.exit(1);if(c.indexOf('BRAIN_EVALUATOR_MODE')>c.indexOf('initTickLoop'))process.exit(1)"`
- [x] `[BEHAVIOR]` harness-watcher.js 不再调用 executeMerge，改为 log 跳过信息
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(c.includes('executeMerge(prUrl)'))process.exit(1);if(!c.includes('skipping auto-merge'))process.exit(1)"`
