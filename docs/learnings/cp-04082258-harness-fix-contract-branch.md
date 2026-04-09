### 根本原因

harness_generate pr_url_missing 和 harness_evaluate FAIL 两条路径在创建 harness_fix 任务时，
未从 harnessPayload 中透传 contract_branch 字段。
导致 harness_fix（Generator）拿不到最终合同所在分支，无法正确读取 sprint-contract.md。

另外 harness-generator SKILL.md 缺少文件搜索约束规则，
Generator 可能执行 find /Users 这类广泛搜索，触发系统级扫描导致进程挂起。

### 下次预防

- [x] 凡从一个 harness_* 任务派生新 harness_fix 任务，必须检查 payload 中是否保留了 contract_branch
- [x] SKILL.md 新增规则：禁止 find /Users、find /home，只能 find .（当前目录）
- [x] 链路跟踪：contract_branch 从 contract_review APPROVED → generate → ci_watch → evaluate → fix 全程传递
