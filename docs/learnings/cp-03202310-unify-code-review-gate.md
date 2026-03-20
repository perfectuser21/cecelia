# Learning: 统一 code_review_gate 任务类型和字段名

## 背景
Pipeline v2 审计发现 03-integrate.md 派发 `task_type=code_review`，但 Brain 注册的 Gate 路由是 `code_review_gate`，导致类型不匹配。

### 根本原因
Pipeline v2 重构时，Brain 侧新增了 `code_review_gate` 类型路由，但 Engine 侧的 03-integrate.md 仍使用旧的 `code_review` 类型名和字段名（`code_review_task_id`/`code_review_status`），未同步更新。

### 下次预防
- [ ] 新增 Brain task_type 路由时，同步检查所有派发端（03-integrate.md、devloop-check.sh）是否使用一致的类型名
- [ ] 在 Pipeline 重构 PR 的 DoD 中增加"task_type 一致性检查"条目
- [ ] 考虑将 task_type 常量提取到共享配置中，避免多处硬编码
