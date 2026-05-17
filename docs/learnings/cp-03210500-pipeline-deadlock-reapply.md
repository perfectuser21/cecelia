# Learning: Pipeline 死锁修复被 rebase 覆盖

## 发生了什么

PR #1286 修复了三个 Pipeline 死锁问题（合并失败终止工作流、Codex 审查永久阻塞、缺少超时时间戳），但被 #1284 的 rebase 覆盖，修复从 main 上消失。

### 根本原因

并行 PR 的 rebase 覆盖问题：#1284 在 #1286 之后 rebase 到 main 时，用旧版本覆盖了 #1286 的修改。两个 PR 修改了相同文件（devloop-check.sh），但 GitHub 的 squash merge 没有产生冲突警告。

### 下次预防

- [ ] 对同一文件有并行 PR 时，后合并的 PR 必须先 rebase 到最新 main 再合并
- [ ] CI 可考虑加入"关键修复覆盖检测"：检查 main 上最近合并的 PR 修改的文件是否被当前 PR 的旧版本覆盖
- [ ] 合并后立即验证关键修复仍在 main 上（特别是死锁/超时相关的安全修复）
