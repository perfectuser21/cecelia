# B37 — parsePrdNode sprint_dir 依赖 LLM 输出解析（不可靠）

### 根本原因

B35/B36 从 planner 的 LLM 输出文本解析 sprint_dir：先取最后一个匹配。但 planner 有时在其输出中把历史 sprint 目录作为 verdict 的 sprint_dir 值（如 w19-playground-sum），导致 Brain 把错误的目录传给 proposer。

实际 worktree 中正确的目录由 git 记录（planner 新建 sprint-prd.md 并 commit）——用 `git diff origin/main HEAD -- sprints/` 能确定性找到。

### 下次预防

- [ ] LLM 输出解析只作为 fallback，不作为主路径
- [ ] 有 git worktree 可用时，优先从 git 状态推断文件系统变更
- [ ] 新增 sprint_dir 提取逻辑后，必须端对端 run 一次真实 harness pipeline 验证
