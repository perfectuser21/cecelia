task_id: 3f32212a-adc2-436b-b828-51820a2379e6
branch: cp-0425185125-docker-timeout-tier-aware

## 任务标题

Docker Executor Timeout 默认 90min + per-tier timeoutMs

## 任务描述

`packages/brain/src/docker-executor.js:36` `DEFAULT_TIMEOUT_MS = 900000`（15min）让 Generator
跑大改动被 SIGKILL。改默认到 90min，并把 timeoutMs 维度引入 RESOURCE_TIERS（light=30 / normal=90 /
heavy=120 / pipeline-heavy=180 分钟），`executeInDocker` 优先级
`opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS`。

## DoD

- [x] [ARTIFACT] docker-executor.js DEFAULT_TIMEOUT_MS=5400000
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(!c.includes(\"CECELIA_DOCKER_TIMEOUT_MS || '5400000'\"))process.exit(1)"

- [x] [ARTIFACT] resource-tier.js RESOURCE_TIERS 含 timeoutMs 字段（light=30min + pipeline-heavy=180min）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/middleware/resource-tier.js','utf8');if(!/timeoutMs:\s*30\s*\*\s*60\s*\*\s*1000/.test(c))process.exit(1);if(!/timeoutMs:\s*180\s*\*\s*60\s*\*\s*1000/.test(c))process.exit(1)"

- [x] [ARTIFACT] executeInDocker 用 tier.timeoutMs 兜底
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(!/opts\.timeoutMs \|\| tier\.timeoutMs \|\| DEFAULT_TIMEOUT_MS/.test(c))process.exit(1)"

- [x] [BEHAVIOR] tier=normal/dev/planner/pipeline-heavy 任务用对应 timeoutMs（mock runDocker 验证）
  Test: packages/brain/src/__tests__/docker-executor-timeout.test.js

- [x] [BEHAVIOR] resource-tier 4 个 tier timeoutMs 数值精确匹配 spec + 排序
  Test: packages/brain/src/spawn/middleware/__tests__/resource-tier.test.js

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0425185125-docker-timeout-tier-aware.md')"

## 目标文件

- packages/brain/src/docker-executor.js
- packages/brain/src/spawn/middleware/resource-tier.js
- packages/brain/src/__tests__/docker-executor-timeout.test.js
- packages/brain/src/spawn/middleware/__tests__/resource-tier.test.js
- docs/learnings/cp-0425185125-docker-timeout-tier-aware.md
