# Learning: cp-03222201-cleanup-prd-task-artifacts

## 任务概述
清理 main 上 641 个 prd/task 残留文件，新增自动代谢 workflow，补充 04-ship.md cleanup 指令。

### 根本原因

- `.prd-*.md` / `.task-*.md` 文件在 PR 合并后没有自动清理机制，每次 PR 合并都在 main 积累两个文件
- 新增 `.github/workflows/` 文件后 PR 标题忘记加 `[CONFIG]` 前缀，触发 L1 CI Config Audit 失败
- `feat:` 前缀的 PR 未同步添加测试文件，触发 L3 Coverage Gate 失败
- `gh run rerun` 重跑不会更新 PR 标题环境变量，修改 PR 标题后必须 push 新 commit 才能触发新 CI run
- 跨 session 恢复工作时，部分文件已在前一 session 修改完毕，缺少验证导致做了无效操作

### 下次预防

- [ ] 新增 `.github/workflows/` 文件时，PR 标题必须提前含 `[CONFIG]` 前缀，不要等 CI 报错
- [ ] `feat:` 前缀的 PR 新增 CI workflow 时，同步创建对应结构验证测试文件
- [ ] `gh run rerun` 改 PR 标题后无效，需 push 新 commit 重新触发 CI run
- [ ] 跨 session 继续工作时，先 `git log --oneline` 确认已有 commits，避免重复操作
- [ ] 批量清理用 `git rm` 而非 `rm`（确保从 git 索引中移除）
