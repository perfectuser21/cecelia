# DoD: cp-0505222606 deploy-clean-build-isolation

## 概述
长期治本 Brain deploy 三层叠加 bug：
1. brain-build.sh 用 git archive HEAD 隔离脏工作树（不再让未 commit 的 package.json 污染 image）
2. ops.js deploy-webhook stdio 改 ['ignore', logFd, logFd]，deploy-local.sh 输出落盘 /tmp/cecelia-deploy-*.log
3. status API 加 log_path 字段，运维失败时立即知道去哪看 npm error

## 验收

- [x] [BEHAVIOR] brain-build.sh 用 git archive HEAD 输出到 mktemp 临时 dir，docker build 上下文 = git HEAD 快照不是工作树
  Test: manual:bash packages/engine/tests/integration/brain-build-isolation.test.sh

- [x] [BEHAVIOR] git archive HEAD 真隔离脏工作树（写脏 + 跑 archive，extract 出来是 commit 内容）
  Test: manual:bash packages/engine/tests/integration/brain-build-isolation.test.sh

- [x] [BEHAVIOR] git archive 不包含 untracked 文件（脏工作树未追踪文件不污染 image）
  Test: manual:bash packages/engine/tests/integration/brain-build-isolation.test.sh

- [x] [BEHAVIOR] ops.js deploy-webhook spawn stdio 改数组 [ignore, fd, fd]（不再 'ignore'），让 stdout/stderr 落盘
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/deploy-webhook-log.test.js"

- [x] [BEHAVIOR] deploy 状态 API 含 log_path 字段指向 /tmp/cecelia-deploy-*.log
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/deploy-webhook-log.test.js"

- [x] [BEHAVIOR] log 文件实际创建并写入启动 metadata（cmd / cwd）
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/deploy-webhook-log.test.js"

- [x] [BEHAVIOR] 既有 deploy-repo-root 测试 2/2 不破（向下兼容）
  Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/deploy-repo-root.test.js"

- [x] [ARTIFACT] scripts/brain-build.sh 含 git archive HEAD 关键调用
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-build.sh','utf8'); if (!c.includes('git -C') || !c.includes('archive --format=tar HEAD')) process.exit(1)"

- [x] [ARTIFACT] scripts/brain-build.sh trap 清理临时 dir
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-build.sh','utf8'); if (!c.match(/trap.*TEMP_BUILD.*EXIT/)) process.exit(1)"

- [x] [ARTIFACT] ops.js deploy spawn 段不含 stdio:'ignore'（应是数组）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/ops.js','utf8'); const m=c.match(/POST.*\\/deploy.*?spawn[\\s\\S]{0,1500}/); if (!m || !m[0].includes('logFd, logFd')) process.exit(1)"

- [x] [ARTIFACT] ops.js deployState 含 log_path 字段
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/ops.js','utf8'); if (!c.includes('deployState.log_path')) process.exit(1)"

- [x] [ARTIFACT] 新建 deploy-webhook-log.test.js
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/deploy-webhook-log.test.js')"

- [x] [ARTIFACT] 新建 brain-build-isolation.test.sh
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/integration/brain-build-isolation.test.sh')"
