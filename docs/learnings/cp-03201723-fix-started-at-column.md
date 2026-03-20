# Learning: migration 164 遗漏 started_at 列

## 日期
2026-03-20

## 分支
cp-032020-fix-started-at-column

### 根本原因
migration 164 修复缺失列时，只关注了 `completed_at`（WHERE 条件中使用），忽略了 `started_at`（ORDER BY 中使用）。`metrics.js` 的 `getRecentTickTime()` 查询同时依赖这两列，但编写 migration 时没有完整分析 SQL 语句的所有列引用。

### 下次预防
- [ ] 编写 migration 修复缺失列前，先用 grep 搜索该表所有被引用的列名，确保一次性补全
- [ ] migration 编写后，对比查询代码中引用的所有列，逐一确认 migration 是否覆盖
- [ ] 考虑在 CI 中加入 SQL 列引用 vs schema 的静态检查
