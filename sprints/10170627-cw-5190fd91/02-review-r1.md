---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 8
场景覆盖: 7
回归风险: 8
可执行: 8

### R-1
针对: S-2, Q-2, I-2
严重度: 重要
场景: 运维人员查看一份 `outputs.pr_url` 为 `https://example.invalid/pull/37` 的回执，同目录有 `cifix-37.json`；手册说无有效 PR URL 时 `ci_fix:null`，实际 `status.mjs --json` 却显示该文件的修复次数，误以为该回执关联了有效 PR 的 CI 修复记录。
依据: `packages/brain/scripts/coding-workflow/runner/status.mjs` 的 `ciFixSummary` 只用 `/\/pull\/(\d+)(?:[/?#]|$)/` 提取编号，没有校验域名或 PR 是否存在；`lib/receipt.mjs` 的 `summarizeReceipt` 接受任何非空字符串作为 `pr_url`。Q-2 只使用 GitHub 形式的 URL，验不到这一分支。
说明: S-2 应按源码写明 `ci_fix` 仅按 URL 字符串中的 `/pull/<编号>` 关联本地文件，不能把它称作有效 PR 或外部 CI 事实；在 Q-2 增加一份非 GitHub URL 的临时回执，核对 CLI 输出与最终 README 的限制说明。
