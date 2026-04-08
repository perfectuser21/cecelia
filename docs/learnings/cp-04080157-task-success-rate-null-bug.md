# Learning: PostgreSQL NULL 语义导致成功率计算失真

## 背景

SelfDrive `getTaskStats24h()` 在 PR #2017 修复 auth 排除逻辑后，引入了
PostgreSQL NULL 语义 bug，导致成功率从 48% 跳变为 3000%+。

### 根本原因

PostgreSQL 中 `NULL != 'auth'` 返回 NULL（不是 TRUE），在 FILTER WHERE 中等价于 FALSE。

```sql
-- 有 bug：failure_class=NULL 的任务被排除（绝大多数正常完成任务）
payload->>'failure_class' != 'auth'

-- 正确：显式处理 NULL
(payload->>'failure_class' IS NULL OR payload->>'failure_class' != 'auth')
```

影响：233/252 个完成任务的 failure_class 为 NULL，total 从 252 降到 8，
成功率 = 239/8 ≈ 3000%，SelfDrive 误报"正常"忽略了失败。

### 下次预防

- [ ] 所有否定型字段过滤（`!= 'x'`、`NOT IN`）必须同时写 `IS NULL OR` 子句
- [ ] 添加成功率范围断言：success_rate > 100% 触发告警（不可能正确）
- [ ] SQL 逻辑变更时，用实际数据验证 total ≥ completed（否则分母太小）
