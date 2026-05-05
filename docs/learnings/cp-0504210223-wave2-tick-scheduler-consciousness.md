# Learning — Wave 2 实现计划入库（2026-05-04）

分支：cp-0504210223-wave2-tick-scheduler-consciousness
PR：#2762（735 行实现计划 doc 单独入库）
日期：2026-05-04
模式：plan-first（计划文档先于实现 PR 入主线）

## 根本原因

Wave 2（tick-scheduler + consciousness-loop）启动时把 735 行的实现计划 doc（`docs/superpowers/plans/2026-05-04-wave2-tick-scheduler-consciousness.md`）放在 worktree 里待提交。如果不先单独入主线：

- 计划文件可能在 worktree 久不入库被废弃
- 多 session 并行 impl 时各自 fork plan 漂移
- 后续 PR 引用 plan 文件路径时主线上不存在

stop hook 的 verify_dev_complete 三阶段（PR merged → Learning → cleanup）触发时，`step_1_spec: pending` 的 worktree 一旦有 commit 就会被识别为可推进的 dev session。本次由 stop hook 反馈链 push + PR + auto-merge，把 plan-first 模式跑通。

## 下次预防

- [ ] 大型 wave/feature 开工前，先单独 PR 入库实现计划文档（plan-first）
- [ ] 计划文档以 worktree branch name 为锚（`docs/superpowers/plans/YYYY-MM-DD-<topic>.md`）
- [ ] 计划入库后再启动 impl PR，引用 plan 文件路径
- [ ] stop-dev.sh 仍需补 ghost 过滤（remote sync 文件 + worktree 不存在 + 0 commit + session_id=unknown 应跳过 verify）

## 上下文

本 Learning 由 stop hook 反馈链补写——PR #2762 仅含 plan doc，无 impl，wave2 真正实现仍在 owner session 推进中。Learning 由独立 hotfix 分支 `cp-05042114-wave2-learning` 入库（避免在 main 直 commit）。
