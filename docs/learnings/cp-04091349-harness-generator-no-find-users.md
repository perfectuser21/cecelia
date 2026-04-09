# Learning: harness-generator find /Users 挂起 + harness_fix contract_branch 断链

### 根本原因

1. harness-generator SKILL.md 未规定文件搜索范围，Generator agent 用 `find /Users/administrator -name "server.js"` 遍历整个用户目录，iCloud Drive 等网络挂载导致挂起数小时。
2. execution.js 创建 harness_fix（pr_url_missing 和 evaluate FAIL 两处）时未传递 `contract_branch`，导致 executor.js 无法从正确分支读取 sprint-contract.md 注入 prompt，harness_fix agent 不知道要实现什么。

### 下次预防

- [x] harness-generator SKILL.md 加"文件搜索规则"，明确禁止 find /Users，只用相对路径 `find . ...`
- [x] execution.js pr_url_missing → harness_fix payload 补传 `planner_branch` + `contract_branch`
- [x] execution.js evaluate FAIL → harness_fix payload 补传 `planner_branch` + `contract_branch`
