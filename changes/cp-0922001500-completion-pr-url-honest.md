## Brain {VERSION} — 完成态闸不认回写协议里的 pr_url；被拒时还发成功回执

- `engine-pr-watchdog` 规定的终态回写是 `PATCH {status:'completed', result:{pr_url}}`，
  而 `finalizeHarnessTask` 只看 `task.pr_url` / `payload.pr_url`，**从不看 result.pr_url**。
  协议两头对不上 → 必然落到"按分支名反查 GitHub"兜底 → 分支名里没有 task 短 id →
  必然 `pr_not_found`。0921-0922 连撞三条任务：活干完、PR 已合并，账本永远回不去
  （issue a4991491）。
- 闸改为也认请求里带的 URL，但**只当线索**：仍要 `gh pr view` 核到 `state=MERGED` 才认，
  非法 URL 当没给。优先级 = 库里的 > payload 里的 > 请求里的（调用方自报可信度最低）。
- 被闸拒时不再返回 `success: true`。请求的状态变更没发生，报成功就是"写被丢弃却发成功
  回执"（issue 9cce296f 那一族）。HTTP 仍 200 且保留 `accepted:false` —— 既有调用方按
  这个契约判（harness-completion-authority.test.js），改 HTTP 码会连带打翻它们。
- 守卫 6 条 + 变异 5 项全部真断言失败（含"闸不再认请求里的 pr_url"、"请求值照单全收
  不核 MERGED"、"回执退回恒真 success"）。
