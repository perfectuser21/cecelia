# Learning: Dashboard ViralAnalysis 3 个阻断 Bug 修复

**分支**: cp-04090536-638031be-54f4-4a0c-98db-cb0804
**日期**: 2026-04-09

### 根本原因

新增 `ViralAnalysisPage`（PR #2057）时，前端类型定义与后端 SQL 有 3 处不匹配：

1. **SQL 未 SELECT `id` 字段** — `getTopContentByPlatform()` 的 SELECT 子句省略了 `id` 列，导致 React 渲染时 `key={item.id}` 全部为 `undefined`，控制台报 key 重复警告。
2. **数字字段以字符串返回** — PostgreSQL 的 `views/likes/comments/shares` 列（`NUMERIC` 类型）在 Node.js pg 驱动中以字符串返回，前端做 `item.likes + item.comments + item.shares` 触发字符串拼接而非加法，互动率计算完全错误。
3. **`days` 参数被后端忽略** — `GET /analytics/content` 路由只解析 `since`，不解析 `days`，前端切换 7/14/30 天窗口无实际效果。

### 修复方案

1. `content-analytics.js`：SQL 加入 `id`，对数字列添加 `::int` 类型转换
2. `analytics.js`：`GET /analytics/content` 新增 `days` 参数支持
3. `ViralAnalysisPage.tsx`：用 `Number(item.views)` 等显式转换，key 加 `?? item.content_id ?? String(i)` 兜底

### 下次预防

- [ ] 新增 Analytics API 时，**必须用 `::int`/`::numeric` 显式 cast**，避免 pg 驱动返回字符串
- [ ] 前端做数值运算前，验证字段类型（数字 vs 字符串），或直接在 API 层保证类型
- [ ] 新页面必须检查：React key 是否来自真实存在的 API 字段，而非只看类型定义
- [ ] 新增带过滤参数的 API（如 `days`），前后端必须同步支持
