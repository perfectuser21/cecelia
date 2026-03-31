# Learning: devloop-check 会话压缩恢复入口

## 概述

- **分支**: cp-03312358-devloop-session-recovery
- **任务**: 为 devloop-check.sh 添加直接执行入口，解决会话压缩重启后 agent 迷失方向的问题
- **时间**: 2026-04-01

## 根本原因

`devloop-check.sh` 设计为 library（被 stop hook source 引入），缺少直接执行入口。
会话压缩重启后，agent 不知道自己在哪个 stage，需要手动检查多个文件才能恢复。
`.dev-mode.*` 被 gitignore 且存在于 worktree 目录，agent 重启后不知道去哪里找。
没有标准的会话恢复命令，恢复过程依赖人工知识而非工具化能力。

## 解决方案

在 `devloop-check.sh` 末尾添加 `devloop_check_main()` 函数和直接执行检测块：
```bash
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    devloop_check_main "$@"
fi
```

`devloop_check_main()` 自动搜索主仓库 + 所有 worktree 中的 `.dev-mode.*` 文件，
调用 `devloop_check()` 获取状态，输出人类可读的诊断报告。

## Hook 系统 Worktree 局限

### 根本原因

branch-protect.sh 和 bash-guard.sh 在 Claude Code 的主进程运行，
执行 `git rev-parse --abbrev-ref HEAD` 返回主仓库分支（main），
不是 worktree 内的功能分支。导致：
1. verify-step.sh 的 `BRANCH` 是 `main` 而不是 `cp-*`
2. `git diff origin/main...HEAD` 在 main vs main 下无任何 diff
3. Lite seal 文件需要在主仓库放 `.dev-gate-lite.main` 才能通过检查

### 下次预防

- [ ] hook 系统需要识别 worktree 场景：当 Write/Edit 的文件路径在 worktree 内时，用 worktree 的 BRANCH 而不是主仓库的 BRANCH
- [ ] verify-step.sh step2 的 `git diff` 应支持指定 PROJECT_ROOT，在 worktree 路径下执行
- [ ] 临时绕过方法：在主仓库放 `.dev-gate-lite.main` + 用 sed 变量方式写 .dev-mode
