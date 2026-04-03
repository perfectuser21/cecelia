# Learning: Brain API degraded — auto-fix tags 查询 + escalation null

**分支**: cp-04030340-0b58ce98-1733-4960-93bb-4b0ef6
**日期**: 2026-04-03

### 根本原因

1. **`auto-fix.js` tags 类型错误**：`tasks.tags` 列是 `text[]`（PostgreSQL 原生数组），但代码用 `tags::jsonb ? $1` 做 contains 查询。PostgreSQL 无法将 `text[]` 强转为 `jsonb`，报 `cannot cast type text[] to jsonb`，导致所有 probe 失败时 auto-fix 任务无法创建。

2. **`escalation.js` from_level null**：`escalationState.currentLevel` 初始化为 `null`，首次触发升级时 `oldLevel=null` 写入 `from_level VARCHAR NOT NULL` 列，违反 NOT NULL 约束。

### 根因分析

- 两处 bug 独立存在，均导致 Brain 启动日志报错，但均为非致命错误（catch 后继续）
- degraded 模式根因是 ENV_REGION 未加载（已通过 launchctl plist 配置解决，无需代码修改）
- auto-fix 链路完全失效导致 probe 失败无法自愈

### 下次预防

- [ ] `text[]` 列用 `$1 = ANY(column)` 或 `column @> ARRAY[$1]::text[]`，禁止 `::jsonb`
- [ ] `createTask` 的 `tags` 参数应传 JS 数组，不要 `JSON.stringify`（pg 驱动自动处理数组序列化）
- [ ] DB INSERT 前检查 NOT NULL 列是否有 null 来源，特别是初始状态
- [ ] 新增 `escalationState` 初始值时注意 `currentLevel: null` 会在首次 INSERT 时违约
