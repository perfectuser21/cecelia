# Learning: SelfDrive 成功率统计 SQL NULL 陷阱

**PR**: fix(brain): SelfDrive getTaskStats24h total filter NULL陷阱 — 修复3063%异常成功率

---

### 根本原因

`getTaskStats24h()` 中 `total` 的 SQL filter 对所有状态统一施加了 `payload->>'failure_class' != 'auth'` 条件：

```sql
-- 问题代码
count(*) filter (where status IN ('completed', 'failed', 'quarantined')
  AND payload->>'failure_class' != 'auth'   -- ← 这里
  AND (...)) as total
```

**SQL NULL 语义陷阱**：`completed` 任务没有 `failure_class` 字段（值为 NULL）。
在 PostgreSQL 中，`NULL != 'auth'` 结果是 `NULL`（不是 TRUE），所以 `completed` 任务完全不进 `total`。

结果：`completed=237, total=8 → 237/8=2962% ≈ 3063%`（Brain 报告的异常值）

---

### 下次预防

- [ ] 写 SQL filter 时，如果要"排除某个值"，必须同时处理 NULL：用 `(col IS NULL OR col != 'auth')` 而不是 `col != 'auth'`
- [ ] 任何成功率/比值计算，分母(total)的计算逻辑必须与分子(numerator)的计算逻辑口径一致，不能引入额外过滤
- [ ] `completed` 任务天然不会有 `failure_class`，不需要对其做 failure_class 过滤

### 修复方式

将 `total` 拆成两段 OR 条件：
```sql
count(*) filter (where
  (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours')
  OR
  (status IN ('failed', 'quarantined')
    AND (payload->>'failure_class' IS NULL OR payload->>'failure_class' != 'auth')
    AND (completed_at > NOW() - INTERVAL '24 hours' OR updated_at > NOW() - INTERVAL '24 hours'))
) as total
```
