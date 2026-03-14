## [2026-03-14] worktree-manage.sh 新增 MAX_WORKTREES=8 数量上限检查

**失败统计**：CI 失败 2 次，本地测试失败 0 次

### 根本原因

**CI 失败 #1**：Learning Format Gate 失败——未在 push 前创建 Learning 文件。
`docs/learnings/<branch>.md` 必须包含在 PR diff 中，CI 在第一次运行时就会检查，不能事后补写。

**CI 失败 #2**：Learning 格式不符合要求——缺少 `### 下次预防` 章节和 `- [ ]` checklist 格式的预防措施。
`check-learning.sh` 用正则匹配 `^#{1,4}\s*(下次预防|Prevention|预防措施)` 和 `^- \[[ xX]\]`，
纯 markdown 粗体标题（`**预防措施**:`）无法通过检测。

**功能本身**：在 cmd_create() 中加入 `MAX_WORKTREES=8` 检查，防止 Brain 并发派发时磁盘被撑满。实现简单，无其他问题。

### 下次预防

- [ ] Learning 文件必须在第一次 `git push` 之前写好并加入 commit，不能 CI 失败后补写
- [ ] Learning 格式必须用 `### 下次预防` 标题（H3 Markdown 标题），不能用 `**预防措施**:` 粗体
- [ ] Learning 中预防措施必须用 `- [ ]` checklist 格式，不能是普通列表

**影响程度**：Low（功能本身简单，问题集中在流程规范）
