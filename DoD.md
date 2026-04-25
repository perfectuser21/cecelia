task_id: baa16433-91d0-4628-b078-08757d22bd44
branch: cp-0425185121-harness-v6-p1d-brain-env-inject

## 任务标题

[Harness v6 P1-D] Brain 派 harness_task 注入 CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL env

## 任务描述

Brain↔Generator prompt env 协议固化：harness-task-dispatch 显式注入 6 字段 env，entrypoint.sh 自动重写宿主 git remote 为 https，Generator SKILL Step 0 自检列表对齐。

修复 Gen2 (3329655d) 自我 ABORTED：SKILL 自检 CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL 全部缺失 + git remote 是宿主路径不可达。

## DoD

- [x] [ARTIFACT] dispatch env 含 6 个新字段 (CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL/WORKSTREAM_INDEX/WORKSTREAM_COUNT/PLANNER_BRANCH)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-task-dispatch.js','utf8'); for (const k of ['CONTRACT_BRANCH','SPRINT_DIR','BRAIN_URL','WORKSTREAM_INDEX','WORKSTREAM_COUNT','PLANNER_BRANCH']) { if (!c.includes(k)) { console.error('missing '+k); process.exit(1); } }"

- [x] [ARTIFACT] entrypoint.sh git remote 自动重写
  Test: manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8'); if (!c.includes('git remote set-url origin')) process.exit(1); if (!c.includes('https://github.com/perfectuser21/cecelia.git')) process.exit(1);"

- [x] [ARTIFACT] SKILL.md Step 0 自检列表对齐 4 项 + Step 0.4 git remote 验证
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8'); for (const k of ['CONTRACT_BRANCH','SPRINT_DIR','BRAIN_URL','WORKSTREAM_INDEX']) { if (!c.includes(k)) { console.error('skill missing '+k); process.exit(1); } } if (!c.includes('Step 0.4')) process.exit(1);"

- [x] [BEHAVIOR] 单测覆盖 env 协议 (5 断言全绿)
  Test: packages/brain/src/__tests__/harness-task-dispatch.test.js

- [x] [BEHAVIOR] WORKSTREAM_INDEX 双来源解析 (workstream_index | logical_task_id ws<N>)
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-task-dispatch.js','utf8'); if (!c.includes('extractWorkstreamIndex')) process.exit(1); if (!c.includes('logical_task_id')) process.exit(1);"

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0425185121-harness-v6-p1d-brain-env-inject.md')"

## 目标文件

- packages/brain/src/harness-task-dispatch.js
- packages/brain/src/__tests__/harness-task-dispatch.test.js
- docker/cecelia-runner/entrypoint.sh
- packages/workflows/skills/harness-generator/SKILL.md
- docs/learnings/cp-0425185121-harness-v6-p1d-brain-env-inject.md
