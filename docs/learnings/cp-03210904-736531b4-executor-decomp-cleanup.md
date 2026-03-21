# Learning: executor.js decomp_review 清理

## 任务
删除 executor.js 中 `decomp_review` 相关代码（skillMap 条目 + handler 代码块）

### 根本原因
Pipeline v2 改造后，`decomp_review` task type 已被 Codex Gate 替代，但 executor.js 中的 skillMap 映射和 handler 代码块未被清理，形成死代码。

### 下次预防
- [ ] 删除 task type 时，同时检查 executor.js 的 skillMap 和 handler 两处
- [ ] 旧 task type 删除后，确认无测试文件引用（本次已验证无测试引用）
- [ ] Pipeline v2 改造后应在 DoD 中明确追踪所有 executor.js 残留清理项
