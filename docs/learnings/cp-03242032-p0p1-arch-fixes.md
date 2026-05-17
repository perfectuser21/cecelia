# Learning: P0/P1 Brain 架构问题修复

**分支**: cp-03242032-p0p1-arch-fixes
**日期**: 2026-03-24
**Task ID**: a2f3e8db-c3a9-458e-82f3-d317a3005b7c

## 修复内容

1. `decision.js` UNION 子查询 `priority` 列缺失 → 每次 tick 报 `column g.priority does not exist`
2. `actions.js` createTask dedup 未覆盖 `failed` 状态 → Rumination/cortex/auto_fix 自循环重复创建任务
3. `auto-fix.js` 无重试上限 → RCA→auto-fix 潜在死循环

### 根本原因

**Fix 1**: OKR 迁移（`goals` → `key_results + objectives`）时修改了 UNION 子查询的 SELECT 列表，但遗漏了 `priority` 列，而 `ORDER BY g.priority` 未做相应修改。

**Fix 2**: `createTask` dedup 逻辑仅检查 `status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours')`，未覆盖 `status = 'failed'`。系统驱动的任务（rumination/cortex/auto_fix）在创建任务失败后，下次触发时会再次创建相同任务，形成自循环。

**Fix 3**: `dispatchToDevSkill` 无失败次数检查，每次 RCA 分析结果到达就创建新的修复任务，不管之前是否失败过。

### 下次预防

- [ ] OKR 表迁移时检查所有 UNION 查询的 SELECT 列表与 ORDER BY 子句是否一致
- [ ] 系统驱动任务（trigger_source 非用户）的 createTask 需要额外的 `failed` 状态去重
- [ ] 所有自动创建任务的模块（auto-fix、cortex、rumination）都应有重试上限
- [ ] 新增自动创建任务路径时必须审查：是否有去重？是否有上限？是否有反馈闭环？

## 技术细节

### Fix 1（3行改动）

```sql
-- 修改前
SELECT id, title, status, progress, created_at FROM key_results WHERE status != 'completed'
UNION ALL
SELECT id, title, status, 0 AS progress, created_at FROM objectives WHERE status != 'completed'

-- 修改后
SELECT id, title, status, progress, created_at, priority FROM key_results WHERE status != 'completed'
UNION ALL
SELECT id, title, status, 0 AS progress, created_at, priority FROM objectives WHERE status != 'completed'
```

### Fix 2（扩展去重逻辑）

在 `actions.js createTask()` 的 dedup 查询中，对 `SYSTEM_TRIGGER_SOURCES = ['rumination', 'cortex', 'auto_fix']` 额外检查 72h 内 failed 的同标题任务。

### Fix 3（添加守卫）

在 `auto-fix.js dispatchToDevSkill()` 开头添加查询：
1. 计算同 signature 的 failed auto-fix 任务数（7天内）
2. 如果 `failed_count >= MAX_AUTO_FIX_ATTEMPTS (3)`，直接返回 null 并记录警告

## 影响范围

- `packages/brain/src/decision.js` — compareGoalProgress 函数
- `packages/brain/src/actions.js` — createTask 函数
- `packages/brain/src/auto-fix.js` — dispatchToDevSkill 函数
- 测试：decision.test.js 和 auto-fix.test.js 各更新
