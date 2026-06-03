# PRD — harness merge_pr BEHIND 限次重试 + CONFLICTING 诊断终止

## 背景
Harness 子任务 PR 不由 shepherd 管（shepherd 只在 `MERGEABLE && ci_passed` 时合并，对 CONFLICTING/BEHIND 无补救）；harness PR 由 sub-graph 的 `merge_pr` 节点自管。

`mergePrNode`（packages/brain/src/workflows/harness-task.graph.js）原已有 update-branch 逻辑，但存在两个确定性缺口：
1. `rebase_attempted` 当布尔用 —— 只要 rebase 过一次，第二次再 BEHIND 立刻报错放弃。高合并频率（churn）下 PR 会反复 BEHIND main（见记忆 feedback_pr_stuck_behind_churn），需要重试多次。
2. CONFLICTING（真冲突）未单独识别 —— 只对 merge 错误文本反应，`not mergeable` 被 BEHIND_RE 误判成 BEHIND → 触发 update-branch（解不了真冲突）→ 才报错，reason 含糊且浪费 CI 轮次。

## 目标
1. `rebase_attempted` 改计数器，限次 `MAX_REBASE_ATTEMPTS = 3`：未达上限持续 `gh pr update-branch --rebase`（服务端更新，不本地 rebase 抢 worker）；达上限带 `reason: 'rebase_exhausted'` 终止，不无限刷。
2. 显式查 PR 权威状态（`gh pr view --json mergeable,mergeStateStatus`）区分 BEHIND vs CONFLICTING：真冲突带 `reason: 'conflicting'` 终止，不假装 update-branch 能解、不静默干等到超时。

## 成功标准
- BEHIND 且 rebase_attempted < 3 → 调用 update-branch 并使计数器 +1
- BEHIND 且 rebase_attempted >= 3 → 带 reason 终止，不再调 update-branch
- CONFLICTING（mergeable=CONFLICTING / state=DIRTY）→ 带可诊断 reason 终止，不调 update-branch

## 边界
- 只动 merge_pr 节点的合并/rebase 逻辑，不碰 generator 门禁、不碰 error→END/resume 范式（终止仍走现有 error→END）。
