# Learning: fix(brain) — 砍掉 harness evaluate/ci_watch 链路 + BRAIN_QUIET_MODE 覆盖

## 背景
任务 66ce68db：execution.js 中 harness_generate 完成后直接创建 harness_report；tick.js 中 desire/scan 加 BRAIN_QUIET_MODE 保护。

### 根本原因
- harness_generate → harness_ci_watch → harness_evaluate 链路在三层架构下多余：CI 即 Evaluator，Generator 完成后应直接进入报告阶段
- runDesireSystem / triggerCodeQualityScan 未受 BRAIN_QUIET_MODE 保护，静默模式下仍触发 LLM 后台调用

### 下次预防
- [ ] 新增 harness 链路节点时，检查是否与"CI 即 Evaluator"三层架构原则冲突
- [ ] tick.js 新增后台调用时，默认套 `if (!BRAIN_QUIET_MODE)` 保护
- [ ] branch-protect.sh 在 worktree 子目录 cd 后需先检查 GIT_WORK_TREE，否则 `git rev-parse --show-toplevel` 在 worktree 子目录中失败
