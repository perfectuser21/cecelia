# Learning: execution-callback verdict 持久化 + harness payload 校验

## 任务
fix: execution-callback 存 verdict 到 tasks.result + payload 必填校验

## 根本原因

### Fix 1: verdict 不持久化
harness 任务（harness_evaluate/sprint_evaluate/harness_contract_review 等）完成时，`extractVerdictFromResult()` 提取的 verdict 只用于当前 tick 的链路路由（决定派哪个下游任务），但不写回 DB。导致事后无法从 `tasks.result` 查询哪个任务产出了 PASS/FAIL/APPROVED 等裁决结果。

### Fix 2: ci_watch 无 pr_url 时静默创建
`createHarnessTask({ task_type: 'harness_ci_watch', payload: { pr_url: null } })` 会静默创建一个无效任务——tick 轮询 CI 时 `pr_url` 为 null，导致 CI watch 永远无法找到 PR 状态。

## 解决方案

### Fix 1
在 harness 路由块开头（读取 harnessTask 之后、路由判断之前），对产生 verdict 的任务类型集合（`VERDICT_HARNESS_TYPES`）：提取 verdict → `UPDATE tasks SET result = COALESCE(result, '{}') || {verdict, result_summary}` → 非致命错误处理。

### Fix 2
将 `createTask` import 后包装为 `createHarnessTask`，根据 `HARNESS_REQUIRED_PAYLOAD` 表校验必填字段，缺失则 `throw new Error`（阻断创建）。

## 下次预防

- [ ] 新增产生 verdict 的 harness task_type 时，同步加入 `VERDICT_HARNESS_TYPES`
- [ ] 新增带必填 payload 字段的 harness task_type 时，同步加入 `HARNESS_REQUIRED_PAYLOAD`
- [ ] harness 链路断链测试应验证 tasks.result.verdict 字段存在
