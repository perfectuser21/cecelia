## Brain {VERSION} — coding workflow runner 收尾被外部关闭（未合并）的 PR

- 新增 `runner/lib/pr-closure.mjs`（`settleClosedPrs`），每轮在各道门之前运行：`gh pr list --state closed --search is:unmerged` 列出外部关闭的 cw PR → Brain 只写 result（status 保持 completed）：`runner.phase='closed_unmerged'`、`merge.closed=true`（含 closed_at/head/closed_by）、终态交接单（verdict=CLOSED、无下一步）、commander 已上交的标 `resolved='pr_closed'`；上报终态 span（merge，outcome=fail，reason=`pr_closed_externally`，run_terminal）；本机 `qa-<pr>.json` 记 `closed`（Brain 写成功才记，幂等）
- 分支已删时经 `refs/pull/<n>/head` 取 task_id（`pr-branch.mjs` 新增 `remoteTaskIdByPr`）
- PR 重开：清本机 closed / preview_stopped，Brain phase 回 `awaiting_qa`、merge 置空、记 reopened，各门照常接管
- 停预览：`qa-gate.mjs` 的 `stopMergedPreviews` 移入 pr-closure 改为 `stopFinishedPreviews`：合并的仍要求 QA 通过过，外部关闭的一律停
- 推送前确认 PR 仍开着：`pushPrHead(cfg, worktree, pr)` 先 `gh pr view --json state`，已关抛 `pr_closed`（QA 修复 / CI 修复 / commander 都不推送、不升级、不 Bark、不计尝试），查不到状态抛 `pr_state_unknown`
- 运行时口径：runner 每 tick 自更新到 origin/main，合并后下一轮即生效；首轮会把 #6220 / 任务 4ea44bcf 收尾为 closed_unmerged 并停掉预览 5300
