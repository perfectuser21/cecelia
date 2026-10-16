### R-1
处理: 采纳
说明: `status.mjs` 的 `PR_NUMBER_RE` 只匹配 `/pull/<编号>`，`ciFixSummary` 随后按编号读本地 `cifix-<编号>.json`；`lib/receipt.mjs` 的 `summarizeReceipt` 只要求 `pr_url` 是非空字符串，QA 所述场景确实会发生。S-2 已改为准确描述这种本地关联及其不能证明 PR 有效或外部 CI 事实的边界。Q-2 新增 `https://example.invalid/pull/37` 回执；验证时真运行 `status.mjs` 的 JSON 与普通模式，确认它和 GitHub 形式的回执都显示本地两次尝试，并核对最终 README 明示限制。
