# PRD: Harness v2 Initiative Planner 凭据注入
M2 的 harness-initiative-runner 漏传 CECELIA_CREDENTIALS=account1，导致 Planner 容器无凭据 exit=1。
## 成功标准
harness-initiative-runner.js 的 executor 调用 env 含 CECELIA_CREDENTIALS: 'account1'。
