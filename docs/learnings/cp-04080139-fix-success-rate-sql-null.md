# Learning: PostgreSQL NULL 比较 bug 导致成功率虚报 3063%

**Branch**: cp-04080139-3bcaddfd-605e-4e6d-a3de-09d900
**Date**: 2026-04-08

### 根本原因

`self-drive.js` 中 `getTaskStats24h()` 的 SQL 查询：

```sql
-- BUG: NULL != 'auth' 在 PostgreSQL 中求值为 NULL（非真），而非 TRUE
count(*) filter (where ... AND payload->>'failure_class' != 'auth') as total
```

- `completed` counter: 统计所有 completed 任务（包含 failure_class=NULL 的正常任务）
- `total` counter: 只统计 failure_class IS NOT NULL AND != 'auth' 的任务

导致 total=7（只有非 NULL failure_class 的任务），completed=254（所有已完成），成功率 = 254/7 = 3629%。

### 修复

将 `!= 'auth'` 改为 `IS DISTINCT FROM 'auth'`：

```sql
-- FIX: IS DISTINCT FROM 'auth' 正确处理 NULL（NULL IS DISTINCT FROM 'auth' = TRUE）
count(*) filter (where ... AND (payload->>'failure_class' IS DISTINCT FROM 'auth')) as total
```

### 下次预防

- [ ] PostgreSQL 中凡涉及可能为 NULL 的 JSON 字段的不等比较（`!=`、`<>`），一律改用 `IS DISTINCT FROM`
- [ ] 成功率计算公式写完后，立即用 `SELECT completed, total, completed::float/NULLIF(total,0)*100 as rate` 验证分子分母量级是否合理
- [ ] Brain 诊断报告中如果出现 >200% 的成功率，应触发告警而非静默展示
