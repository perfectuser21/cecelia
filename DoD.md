# DoD — Brain headless session_id + serial workstream

## 分支
cp-04092253-brain-headless-serial-ws

## 验收条目

- [x] [BEHAVIOR] executor.js extraEnv 注入 CLAUDE_SESSION_ID = task.id
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('CLAUDE_SESSION_ID = task.id'))process.exit(1)"

- [x] [BEHAVIOR] execution.js APPROVED 块只创建 workstream_index=1（不再 for 循环）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(c.includes('for (let wsIdx'))process.exit(1)"

- [x] [BEHAVIOR] execution.js harness_generate 完成后若 currentWsIdx < totalWsCount 则串行触发下一个
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('currentWsIdx < totalWsCount'))process.exit(1)"
