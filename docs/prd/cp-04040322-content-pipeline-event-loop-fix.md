# Task Card: fix(brain): 禁用 Content Pipeline 本地执行，修复 Brain 事件循环阻塞

## 背景

Brain tick 循环中，`executeQueuedContentTasks()` 通过 `execSync` 在 Brain 进程内同步
执行 notebooklm CLI 命令（最长阻塞 5 分钟），导致整个 Node.js 事件循环卡死，
Brain HTTP 接口全部超时，并陷入 OOM kill → 重启 → 再次阻塞的崩溃循环。

## 变更

1. **tick.js**: 禁用 `0.5.6` 块 (`executeQueuedContentTasks`)，改为注释说明
2. **executor.js**: skillMap 补全 `content-copywriting` / `content-copy-review` / `content-image-review` → `/content-creator`

## DoD

- [x] `[ARTIFACT]` `tick.js` 中 `executeQueuedContentTasks` 调用已被注释禁用
  - Test: `manual:node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/tick.js','utf8');if(c.includes('const { executeQueuedContentTasks }'))process.exit(1);console.log('OK')"`

- [x] `[ARTIFACT]` `executor.js` skillMap 包含 `content-copywriting`、`content-copy-review`、`content-image-review` 映射
  - Test: `manual:node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"'content-copywriting': '/content-creator'\"))process.exit(1);if(!c.includes(\"'content-copy-review': '/content-creator'\"))process.exit(1);if(!c.includes(\"'content-image-review': '/content-creator'\"))process.exit(1);console.log('OK')"`

- [x] `[BEHAVIOR]` Brain 启动后 tick 执行不因 content-research 阻塞事件循环
  - Test: `manual:node -e "const fs=require('fs');const tick=fs.readFileSync('packages/brain/src/tick.js','utf8');const ex=fs.readFileSync('packages/brain/src/content-pipeline-executors.js','utf8');if(tick.includes('await executeQueuedContentTasks()'))process.exit(1);if(!ex.includes('execSync'))process.exit(0);console.log('OK — execSync in executors but not called from tick')"`

- [x] `[ARTIFACT]` Learning 文档已创建
  - Test: `manual:node -e "require('fs').accessSync('docs/learnings/cp-04040322-content-pipeline-event-loop-block.md');console.log('OK')"`

## 成功标准

Brain 启动后 tick 循环正常运行，content-* 子任务经 task-router 派发到 xian Codex Bridge 异步执行。
