# Learning: devloop-check seal 文件反推

## 任务

Task ID: 6798563e-457d-4463-a26c-8ccb2260a782
Branch: cp-04010829-devloop-check-seal-fallback
PR: TBD

## 问题根因

### 根本原因

`.dev-mode` 文件存储在 worktree 目录中（未 commit），当 worktree 被 GC 或会话压缩时该文件消失。`devloop_check_main()` 此前没有 fallback 机制，直接输出 `NO_ACTIVE_SESSION`，导致 agent 完全失明——不知道之前已完成了哪些 stage，被迫重新开始。

而 seal 文件（`.dev-gate-planner`、`.dev-gate-lite`、`.dev-gate-crg` 等）在 P0 修复后已经 commit 进分支，永远不会因 GC 而消失，因此可以作为可靠的 stage 推断依据。

## 修复方案

在 `devloop_check_main()` 的"无 .dev-mode 文件"分支中：

1. 检测当前 git branch
2. 扫描 worktree 目录中的各类 seal 文件
3. 根据 seal 文件存在与否推断已完成的 stage
4. 用 `gh pr list` 检测远端 PR 状态推断 step_3
5. 输出结构化的诊断信息 + 重建 .dev-mode 的命令参考

## 下次预防

- [ ] seal 文件必须 commit 进分支（已由 P0 修复保证）
- [ ] 新增 stage 时同步更新 seal 反推逻辑
- [ ] devloop_check_main 中的 seal 反推应搜索所有 search_dirs（不只是当前目录）以覆盖跨 worktree 场景
