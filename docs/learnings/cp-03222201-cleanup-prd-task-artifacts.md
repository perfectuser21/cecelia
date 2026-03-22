# Learning: cp-03222201-cleanup-prd-task-artifacts

## 任务概述
清理 main 上 641 个 prd/task 残留文件，新增自动代谢 workflow，补充 04-ship.md cleanup 指令。

### 根本原因
- `.prd-*.md` / `.task-*.md` 文件在 PR 合并后没有自动清理机制
- 每次 PR 合并都会在 main 上积累两个文件（prd + task），长此以往仓库越来越脏
- Stage 4 cleanup 只通过 cleanup.sh 清理，没有明确列出 dev-seal / dev-mode 清理步骤

### 下次预防
- [ ] 新增 GitHub Actions workflow `cleanup-merged-artifacts.yml`，每次 push 到 main 自动删除 prd/task 文件
- [ ] 04-ship.md Stage 4.6 cleanup 明确包含 `rm -f .dev-seal.${BRANCH}` 和 `rm -f .dev-mode.${BRANCH}` 步骤
- [ ] 批量清理用 `git rm` 而非 `rm`（确保从 git 索引中移除）
