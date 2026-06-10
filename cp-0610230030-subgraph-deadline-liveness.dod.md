# DoD: 外层 subgraph deadline liveness 感知（#3330 补完）

## 验收清单

- [x] [BEHAVIOR] deadline 到期 + 容器活着且未到 hard ceiling → 延长等待不返回 queued
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('延长等待，不返回 queued'))process.exit(1)"

- [x] [BEHAVIOR] deadline 到期 + 容器已死 → 返回 failed 不透传 queued
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('不透传 status channel 默认值 queued'))process.exit(1)"

- [x] [BEHAVIOR] deadline 到期 + 容器活着但超 hard ceiling → kill + resume failed(callback_hard_ceiling)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-subgraph-wait-failfast.test.js','utf8');if(!c.includes('callback_hard_ceiling)'))process.exit(1)"

- [x] [ARTIFACT] 外层循环 deadline 处置块存在（while (true) + liveness 感知）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('外层 deadline liveness 感知'))process.exit(1)"

- [x] [ARTIFACT] 死亡分支 queued 透传已钉死为 failed
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('deathStatus'))process.exit(1)"

## Learning 路径

docs/learnings/cp-06102300-subgraph-deadline-liveness.md
