# Code Review Plan - 2026-03-11

## 需要创建 Task 的问题

### P0: [L1-001] Migration 146/147 与代码不一致

- **文件**：`packages/brain/migrations/146_quota_blocked_status.sql`, `packages/brain/migrations/147_brain_config_quota_reset_at.sql`
- **描述**：Migration 添加了 `quota_blocked` 状态和 `quota_reset_at` 配置项，但代码中完全没有实现对应的处理逻辑
- **优先级**：P0
- **修复方式**：
  1. 确认 quota_blocked 和 quota_exhausted 的区别
  2. 在代码中实现对应逻辑，或删除未使用的 migration

### P1: [L2-001] Migration 功能重复

- **文件**：`packages/brain/migrations/146_*.sql`, `packages/brain/migrations/147_*.sql`
- **描述**：quota_blocked 与 quota_exhausted 功能可能重复
- **优先级**：P1

### P2: [L2-002] curiosity-scorer.js 错误处理

- **文件**：`packages/brain/src/curiosity-scorer.js`
- **描述**：DB 查询失败时静默返回默认值
- **优先级**：P2

---

## Brain 回调数据

```json
{
  "decision": "CRITICAL_BLOCK",
  "l1_count": 1,
  "l2_count": 2,
  "security_issues": 0,
  "ai_immune_issues": 0,
  "test_gaps": 0
}
```
