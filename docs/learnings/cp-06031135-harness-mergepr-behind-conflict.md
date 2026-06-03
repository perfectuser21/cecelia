# Learning — harness merge_pr 在 BEHIND/CONFLICTING 的确定性补救

分支: cp-06031135-harness-mergepr-behind-conflict
Brain task: 9dbc9222-6076-4af5-85ce-96ea35efef33

## 现象

harness 子任务 PR 不由 shepherd 管（shepherd 只在 `MERGEABLE && ci_passed` 时合并），改由
sub-graph `merge_pr` 节点自管。该节点虽已有 update-branch 逻辑，但在两种状态下无有效补救：
- 高合并频率（churn）下 PR 反复 BEHIND main 时，第二次 BEHIND 直接放弃（`rebase_attempted` 当布尔用）。
- 真冲突（CONFLICTING）被 `BEHIND_RE` 的 `not mergeable` 误判成 BEHIND，触发解不了的 update-branch，
  reason 含糊还浪费一个 CI 轮次。

## 根本原因

1. `rebase_attempted` 被当成布尔门（`if (state.rebase_attempted)`），而非重试计数器 —— 一次 rebase 后
   就锁死，无法覆盖 main 在 CI 期间又前进的 churn 场景（记忆 feedback_pr_stuck_behind_churn 早已点明）。
2. merge_pr 只对 `gh pr merge` 的**错误文本**反应，从不读 PR 的**权威 mergeable 状态**，导致
   BEHIND（可 update-branch 解）与 CONFLICTING（解不了）无法区分。

## 修复

- `rebase_attempted` 改计数器，`MAX_REBASE_ATTEMPTS = 3`：未达上限持续 `gh pr update-branch --rebase`
  （服务端更新，禁止本地 rebase 抢共享 worker），达上限带 `reason: 'rebase_exhausted'` 终止。
- merge 失败后查 `gh pr view --json mergeable,mergeStateStatus`：CONFLICTING/DIRTY → 带
  `reason: 'conflicting'` 终止，不假装能自动解、不静默干等到超时。
- 终止仍走现有 error→END 范式，未碰 resume/interrupt 节点与 generator 门禁。

## 下次预防

- [ ] 凡是"重试/补救"语义的状态字段，默认用计数器 + 显式上限常量，禁止当布尔门用。
- [ ] PR 合并决策必须读权威 `mergeable`/`mergeStateStatus`，不要只靠 CLI 错误文本正则猜状态。
- [ ] 任何自动补救分支都要带可诊断 `reason` 并限次终止，杜绝"无限刷"或"静默干等到超时"。
