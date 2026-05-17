# Learning: Harness verdict 解析 — cecelia-run 传纯文本导致链路断裂

**分支**: cp-04072343-fix-harness-verdict-parsing  
**日期**: 2026-04-07

### 根本原因

cecelia-run webhook 将 Claude 的完整文本输出作为 `result` 字段传回 Brain。
execution.js 的 `sprint_contract_propose` 处理代码只读对象字段 `result.verdict`，
当 result 是字符串时 verdict 永远是 null → GAN 守卫拦截 → Reviewer 永远不自动创建。

这导致每次 GAN Proposer 完成后都需要手动 curl callback 才能推进流水线。

同样的问题也影响 `sprint_planner` 的 branch 提取（planner_branch 永远是 null）。

`sprint_evaluate` 之前已有正则提取修复，但其他阶段没有同步。

### 下次预防

- [ ] 新增任何 harness 阶段（sprint_*）时，verdict/branch 提取统一用 `extractVerdictFromResult` 辅助函数
- [ ] 不要用 `typeof result === 'object'` 直接读字段——cecelia-run 传的永远是字符串
- [ ] 每个 harness 阶段的 verdict 提取逻辑必须一致，参考 sprint_evaluate 的实现
