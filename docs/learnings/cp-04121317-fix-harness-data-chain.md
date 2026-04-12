# Learning — cp-04121317-fix-harness-data-chain

### 根本原因

Harness Pipeline 数据链断裂。planner_branch 69/95 为 null，pr_url 30/32 为 null。

### 下次预防

- [ ] 所有 branch/pr_url 提取优先从 dev_records 查
- [ ] git branch + gh pr list 作为二级 fallback
