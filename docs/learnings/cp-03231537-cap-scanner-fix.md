# Learning: 修复 capability-scanner skillStats recent_30d 缺失

## 任务

修复 PR #1431 圈复杂度重构后 `skillStats` SQL 查询缺少 `recent_30d` 字段的问题。

### 根本原因

`collectSkillActivity()` 中 `health.usage_30d += parseInt(usage.recent_30d || 0)`，
但 `skillStats` 查询只有 `total_runs / completed / failed / last_run`，无 `recent_30d` 列，
导致所有 skill 路径能力的 `usage_30d` 恒为 0。

### 修复

`skillStats` SQL 新增：
```sql
COUNT(*) FILTER (WHERE ts_start > NOW() - INTERVAL '30 days') AS recent_30d,
```

### 下次预防

- [ ] 重构函数后检查所有依赖该函数 SQL 结果字段的调用方
- [ ] `collectSkillActivity` 中每个 `usage.*` 字段在 SQL 中都应有对应列
