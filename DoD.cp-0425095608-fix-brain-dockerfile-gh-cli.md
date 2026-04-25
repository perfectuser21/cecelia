task_id: 29e87942-a306-4fed-884c-b62858df566e
branch: cp-0425095608-fix-brain-dockerfile-gh-cli

## 任务标题
Brain Dockerfile 装 gh CLI 修 shepherd/watcher 失联

## 任务描述

Harness v6 BLOCKER-B：Brain 容器镜像缺 gh CLI。`packages/brain/src/shepherd.js` 调 `gh pr view/merge`、`packages/brain/src/harness-watcher.js` 调 `gh run list`，容器内执行均 'command not found'。修复方案：`packages/brain/Dockerfile` Stage 2 加独立 RUN，下载 gh release tar (v2.45.0 linux_amd64) 解压抽出二进制到 `/usr/local/bin/gh`。

## DoD

- [x] [ARTIFACT] Dockerfile 含 gh release tarball 下载行
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');if(!/gh_\$\{GH_VERSION\}_linux_amd64\.tar\.gz/.test(c))process.exit(1)"

- [x] [ARTIFACT] Dockerfile 含 gh 二进制 mv 到 /usr/local/bin/gh
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');if(!c.includes('/usr/local/bin/gh'))process.exit(1)"

- [x] [BEHAVIOR] Dockerfile 装 gh CLI 的 RUN 块结构完整（GH_VERSION 变量、wget 下载、tar 解压、mv、rm 清理 5 个动作齐全）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8');const checks=['GH_VERSION=2.45.0','wget -qO-','tar -xz','mv /tmp/gh_','rm -rf /tmp/gh_'];for(const k of checks){if(!c.includes(k)){console.error('missing:',k);process.exit(1)}}"

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-0425095608-fix-brain-dockerfile-gh-cli.md')"

## 目标文件

- packages/brain/Dockerfile
- docs/learnings/cp-0425095608-fix-brain-dockerfile-gh-cli.md

## 备注

PRD 明确说不需要新增单元测试。BEHAVIOR 的"容器装好 gh"由本地 docker build + docker run 验证完成（command -v gh 退出码 0、gh --version 输出 'gh version 2.45.0'）。CI 中无 docker daemon，故 DoD 把 BEHAVIOR 转为对 Dockerfile 5 个关键动作的静态结构检查（GH_VERSION/wget/tar/mv/rm 全齐才能正确装上）。
