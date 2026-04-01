# Learning: devloop-check seal 文件反推

## 任务

Task ID: 6798563e-457d-4463-a26c-8ccb2260a782
Branch: cp-04010829-devloop-check-seal-fallback

## 根本原因

`.dev-mode` 文件存储在 worktree 目录中（未 commit），当 worktree 被 GC 或会话压缩时该文件消失。
`devloop_check_main()` 此前没有 fallback 机制，直接输出 `NO_ACTIVE_SESSION`，导致 agent 完全失明。
Seal 文件在 P0 修复后已 commit 进分支，是比 `.dev-mode` 更可靠的状态记录，但之前没有被利用。

## 修复方案

在 `devloop_check_main()` 的"无 .dev-mode 文件"分支中添加 seal 文件反推逻辑：检测 `.dev-gate-lite`、`.dev-gate-planner`、`.dev-gate-crg`、`.dev-gate-generator` 的存在性，推断各 stage 的完成状态，并输出重建 `.dev-mode` 的命令参考。

## 下次预防

- [ ] seal 文件必须 commit 进分支（已由 P0 修复保证）
- [ ] 新增 stage 时同步更新 seal 反推逻辑（新 seal 类型 → 更新 `devloop_check_main()` 中的推断逻辑）
- [ ] DoD Test 字段不要用反引号包裹，直接用 `manual:` 前缀，否则 CI 正则无法匹配
