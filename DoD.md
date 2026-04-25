task_id: 4ab9a9e8-8cc3-4427-8e78-2145082de5b8
branch: cp-0425095613-harness-v6-phaseb-callback-4ab9a9e8

## 任务标题

Harness v6 Phase B 容器回调链路三联修（writeDockerCallback + pr_url 解析 + harness_ci_watch 创建）

## 任务描述

Phase B 断链：Generator 容器跑完开 PR 后 Brain 毫无感知 → task 永远 queued → 下游 DAG 死锁。
三联修：
1. `docker-executor.js::writeDockerCallback` 用 `parseDockerOutput` + `extractField` 从 stdout 提取 `pr_url` / `verdict` 塞进 `_meta`
2. `harness-task-dispatch.js` 容器跑完调 `writeDockerCallback` 写 `callback_queue`
3. `harness-task-dispatch.js` 解析 `pr_url` 非空时 INSERT `harness_ci_watch` task

## DoD

- [x] [ARTIFACT] docker-executor.js import parseDockerOutput / extractField
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(!/parseDockerOutput/.test(c))process.exit(1);if(!/extractField/.test(c))process.exit(1)"

- [x] [ARTIFACT] docker-executor.js::writeDockerCallback 的 _meta 写 pr_url
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(!/pr_url:\s*prUrl/.test(c))process.exit(1)"

- [x] [ARTIFACT] harness-task-dispatch.js import writeDockerCallback
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-task-dispatch.js','utf8');if(!/writeDockerCallback/.test(c))process.exit(1)"

- [x] [ARTIFACT] harness-task-dispatch.js INSERT harness_ci_watch 语句存在
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-task-dispatch.js','utf8');if(!/harness_ci_watch/.test(c))process.exit(1)"

- [x] [BEHAVIOR] writeDockerCallback 测试：mock stdout 含 pr_url JSON → _meta.pr_url 正确提取
  Test: packages/brain/src/__tests__/docker-executor.test.js

- [x] [BEHAVIOR] harness-task-dispatch 测试：容器 mock 返回 pr_url → pool.query 收到 INSERT harness_ci_watch
  Test: packages/brain/src/__tests__/harness-task-dispatch.test.js

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0425095613-harness-v6-phaseb-callback-4ab9a9e8.md')"

## 目标文件

- packages/brain/src/docker-executor.js
- packages/brain/src/harness-task-dispatch.js
- packages/brain/src/__tests__/docker-executor.test.js
- packages/brain/src/__tests__/harness-task-dispatch.test.js
- docs/learnings/cp-0425095613-harness-v6-phaseb-callback-4ab9a9e8.md
