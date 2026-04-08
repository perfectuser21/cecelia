# Learning: SelfDrive 任务失败率根因修复

**Branch**: cp-04080134-aabe0ea2-35c6-48fb-b1fe-7b23c7  
**Date**: 2026-04-08

---

### 根本原因

**Bug 1: `getTaskStats24h()` NULL 过滤导致成功率显示 3063%**

PostgreSQL 中 `NULL != 'auth'` 返回 `NULL`（falsy），不是 `TRUE`。

```sql
-- 错误: completed 任务 failure_class=NULL 被排除出 total
payload->>'failure_class' != 'auth'

-- 修复: 用 COALESCE 处理 NULL
COALESCE(payload->>'failure_class', '') != 'auth'
```

效果：`total` 从 8 → 260，success_rate 从 3063% → 95%（反映真实状态）

**Bug 2: pipeline_rescue dedup 用 `title LIKE '%branch%'`，多 worktree 下失效**

同一分支的 `.dev-mode.*` 文件存在于多个 worktree 目录。patrol 扫描所有 worktrees，
每次运行都从不同 worktree 路径发现同一分支并创建 rescue 任务。DB dedup 虽用 `title LIKE`
做了查询，但在任务被 quarantine 后的 72h 时间窗判断依然有效，问题在于 `quarantine_cap` 
检查和 `writeCleanupDone` 针对特定 worktree 路径写文件，其他 worktree 副本不受影响。

修复：改用 `payload->>'branch' = $1` 精确匹配（branch 存储在 payload 中，唯一）。

---

### 下次预防

- [ ] 任何 SQL 过滤条件含 `payload->>'field' != 'value'` 时，必须用 `COALESCE(payload->>'field', '') != 'value'`
- [ ] 数据库查询 `!= 'some_value'` 条件在 nullable 列上均需 COALESCE
- [ ] pipeline-patrol 类似的 dedup 逻辑应始终用 payload 字段精确匹配，不用 title LIKE
- [ ] 多 worktree 架构下，任何"存在性检查"要用 DB 字段而非文件系统路径
