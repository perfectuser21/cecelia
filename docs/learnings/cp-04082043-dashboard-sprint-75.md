# Learning: Dashboard 可交付冲刺 (KR5: 58%→75%)

**分支**: cp-04080534-b24f59ec-2aa1-4eaa-bfe0-c246f4
**日期**: 2026-04-08

## 修复内容

1. `task-type-config-cache.js` UPSERT NOT NULL bug
2. BrainModelsPage / CollectionDashboard / AccountUsagePage error handling 统一

---

### 根本原因

**Bug 1：UPSERT INSERT NOT NULL 约束违反**

`task_type_configs` 表的 `executor` 列有 `NOT NULL DEFAULT 'codex_bridge'`。

当 C 类任务（如 `codex_dev`）不在 DB 中时，前端仅发送 `{ location: 'xian' }`，`executor` 为 null。

UPSERT 的 INSERT 路径 `VALUES ($1, $2, $3, ...)` 中 `$3=null` 触发 NOT NULL 约束，因为 PostgreSQL 在 `INSERT VALUES` 时不走列默认值，只在省略列名时走默认值。

**Bug 2：前端静默失败**

4 个页面（BrainModelsPage / CollectionDashboard / AccountUsagePage）的 fetch catch 块用 `/* 静默 */`，用户无法感知加载失败。

---

### 下次预防

- [ ] UPSERT 模式必须检查：INSERT VALUES 路径中的 NOT NULL 列要么提供 COALESCE 默认值，要么该列有 DEFAULT 并且省略列名
- [ ] `catch { /* 静默 */ }` 是反模式，所有涉及用户可见数据的 fetch 必须至少 `setError(...)` 一次
- [ ] 参考 ReportsListPage 的 try/catch + 错误状态展示作为标准模式
