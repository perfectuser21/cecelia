# Learning: checkPrStatus PAT 权限降级修复

## 根本原因
`checkPrStatus` 合并 `state,statusCheckRollup,mergeable` 为一条 `gh pr view` 命令。
当 PAT 无 `checks:read` 权限时，`statusCheckRollup.contexts.nodes.*` 访问失败，
命令以 exit=1 退出，`execSync` 抛出异常，`poll_ci` 捕获后返回 `ci_status: 'pending'`，
导致 poll_ci 轮询 20 次 × 90s = 30 分钟后超时，pipeline 报告 FAIL。
即使 PR 已经 MERGED，也无法正确识别。

## 下次预防
- [ ] `state` 和 `statusCheckRollup` 分两次查询，先查 state：若 MERGED/CLOSED 立即返回，不需要 CI 权限
- [ ] `statusCheckRollup` 查询失败降级为 `ci_no_checks`（空 checks 数组），由调用方据 mergeable 决定
- [ ] PR 已合并是 terminal state，无需任何 CI 信息
