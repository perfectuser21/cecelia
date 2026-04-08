# Task Card: fix execution-callback verdict 写入 + ci_watch payload 校验

## Task ID
9a7e1e0a-3d52-46e5-b6e8-830f5fb47bb5

## 问题
1. execution-callback 处理 harness 任务完成后，从未执行 `UPDATE tasks SET result` — verdict 只用于链路决策，不持久化到 DB
2. createHarnessTask 创建 harness_ci_watch 时，pr_url 可能为 null 但没有任何 warning

## 修复
### Fix 1: verdict 写入 tasks.result
- harness_contract_propose: `{"verdict":"PROPOSED","propose_round":N}`
- harness_contract_review: `{"verdict":"APPROVED"/"REVISION","review_branch":"..."}`
- harness_evaluate: `{"verdict":"PASS"/"FAIL","eval_round":N}`

### Fix 2: ci_watch pr_url warning
- harness_generate → ci_watch: pr_url null 时打印 warning 但允许创建
- harness_fix → ci_watch: 同上

## 文件
- packages/brain/src/routes/execution.js
