# Learning: cp-0505230127 Deploy Origin/Main Isolation (方案 C)

## 概述

PR #2789（方案 B）修了 docker build context 工作树污染，但实战发现：deploy 链路里
还有一层污染没修 — **brain-build.sh 自己用 git archive HEAD，HEAD 是当前 cwd 分支**。
当主仓库 cwd 被另一个 session 切到 cp-* 分支（且没 git pull main），HEAD 是 cp-*
版本，git archive HEAD 拿到的是该分支版本，缺最新合并修复。

## 实战触发现场

PR #2789 merged 后立即触发 deploy 验证：
- 11:53 PR #2789 squash 到 main commit ce10a3715
- 11:53 brain webhook 触发 deploy-local.sh
- 11:54 deploy-local.sh 调 brain-deploy.sh 调 brain-build.sh
- brain-build.sh 跑 `git archive HEAD` — 但本地主仓库 HEAD 是 cp-0505223800-failure-type-deny-payload
  （被另一个 session 切到那个分支工作）
- archive 出来的是 cp-0505223800 版本（无 PR #2789 修复），build 出来的 image
  跟 PR #2789 修复无关
- 同时 cp-0505223800 工作树有未 commit 改动（上次诊断的脏 packages/brain/package.json
  pg ^8.20.0）→ 但因为 git archive 用的是 commit 版（^8.12.0）所以没污染 image
- 最终 deploy 失败原因不是 build，是别的（log 没记录因 stdio:'ignore'）

## 根本原因

deploy 工具链假设 cwd 工作树状态 = 用户期望部署的代码状态。这个假设在多 session 并行
环境下不成立：
- 主仓库 cwd 可能被任何 session 切到任何 cp-* 分支
- 本地 main 可能落后 origin/main（fetch 没跑）
- 工作树可能有未 commit 改动

## 下次预防

- [ ] **deploy 工具链永远从 origin/<deploy_branch> 拉**，不依赖 cwd HEAD：
  - `git fetch origin main && git archive FETCH_HEAD` 替代 `git archive HEAD`
  - VERSION 也从 `origin/main:packages/brain/package.json` 读取
  - DEPLOY_BRANCH env 可覆盖（多环境支持）
- [ ] **不读 cwd 工作树文件做 deploy 决策**：deploy-local.sh 的 changed_paths 检测
  也应改用 `git diff origin/main`（而非 HEAD..origin/main）
- [ ] **未来 deploy 链路任何脚本都要走 fetch + FETCH_HEAD 模式**，不能 implicit 依赖 cwd

## 改动文件

- `scripts/brain-build.sh` — v1.2.0：fetch origin/main + archive FETCH_HEAD（替代 HEAD）
- `packages/engine/tests/integration/brain-build-isolation.test.sh` — 加 2 case 验证 v1.2.0

## 测试结果

- brain-build-isolation.test.sh：8/8 ✅（含 v1.1.0 6 case + v1.2.0 2 case）

## 不动的部分

- `deploy-local.sh` changed_paths 检测（也用 cwd HEAD，但 changed_paths 是 webhook 传入的，
  本地检测仅是 fallback，留作 followup）
- `brain-deploy.sh` migrate / selfcheck 步骤（这些已在 docker container 内跑，自动隔离）
- `ops.js` deploy-webhook（PR #2789 已修 stdio）
