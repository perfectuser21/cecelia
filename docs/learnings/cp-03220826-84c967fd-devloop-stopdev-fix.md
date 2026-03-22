# Learning: devloop-check + stop-dev.sh runtime bug 修复（并行 agent 重复）

**Branch**: cp-03220051-84c967fd-43b9-4c6b-88a8-9ceb72
**Date**: 2026-03-22
**PR**: #1345（已关闭，功能由 PR #1342 覆盖）

---

### 根本原因

Brain 将同一任务派发给了多个并行 agent（本 agent + 另一 agent）。
另一 agent 的 PR #1342 于 08:08:41 先行合并，本 agent 的 PR #1345 于 08:14 创建时功能已在 main。
导致：
1. PR #1345 与 main 产生 merge conflicts（`mergeable: dirty`）
2. GitHub 的 `pull_request` CI 事件因冲突状态可能未被正常投递（`statusCheckRollup: []`）
3. 手动触发 `workflow_dispatch` 的 L3 失败（因缺少 `GITHUB_BASE_REF`，非代码问题）

### 下次预防

- [ ] Stage 3 push 前：先 `git fetch origin main && git log HEAD..origin/main` 检查 main 是否已有相同功能
- [ ] PR 创建后 60 秒内 CI 仍为 0 runs：立即检查 PR mergeable 状态，`dirty` = main 有冲突 = 大概率并行重复
- [ ] `gh api .../pulls/1345 --jq .mergeable_state` 返回 `dirty` → 检查 main 最近 5 条 commit 是否覆盖本 PR 功能
- [ ] 确认重复后直接 `gh pr close` + 注释说明，不要强推修复冲突浪费时间
- [ ] 并行 agent 场景下本次修复仍然完整（6/6 bug 均已修复），只需确认 main 已含修复即可
