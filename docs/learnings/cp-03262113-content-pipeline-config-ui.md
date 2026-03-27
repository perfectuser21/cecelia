# Learning: Content Pipeline 配置可视化前端 + Executor 注入

## 根本原因

本次实现跨多次会话，因 worktree 目录消失导致两次中断重建。根本原因：
- Bash shell CWD 绑定在已删除的 worktree 目录，所有 git 命令失败
- 第一次中断：git add 成功后 worktree 被 GC 清理，未提交的暂存区随 worktree 元数据丢失
- 第二次中断：用 Write 工具恢复了目录但 shell 还是卡在旧 CWD

## 下次预防

- [ ] worktree 操作后立即检查 `git worktree list` 确认注册成功
- [ ] 代码写好后尽快 commit，不要等到所有文件都完成再一起 commit
- [ ] 出现 "Working directory no longer exists" 错误时，先用 Write 工具恢复目录，再所有 Bash 命令前加 `cd /path && `
- [ ] 平行 agent 任务开始前查 Brain 进行中任务，避免重复工作（本次 PR #1611 已并行完成）
- [ ] executor 注入 DB 配置必须带 fallback 到硬编码常量，确保 DB 不可达时 pipeline 不中断
