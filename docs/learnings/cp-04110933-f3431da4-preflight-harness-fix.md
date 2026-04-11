# Learning: harness_* 任务类型未加入 pre-flight SYSTEM_TASK_TYPES 白名单

**分支**: cp-04110933-f3431da4-preflight-harness-fix  
**时间**: 2026-04-11

### 根本原因

`pre-flight-check.js` 的 `SYSTEM_TASK_TYPES` 白名单包含 `sprint_*` 类型，但在引入 `harness_*` 命名体系后（harness v2.0）未同步添加对应类型。所有 `harness_contract_propose`、`harness_contract_review` 等任务因 `description=null` 被 pre-flight 拒绝，永远无法派发。

### 下次预防

- [ ] 新增 task_type 枚举时，必须检查 pre-flight-check.js 的 SYSTEM_TASK_TYPES 白名单
- [ ] 若任务是 Brain 自动生成（无 PRD），应在创建时加入白名单，不依赖手动 description 填写
