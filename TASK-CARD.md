---
id: task-f0828f8f
type: task-card
branch: cp-0411231056-f0828f8f-15fa-404d-b9c5-7f7ce4
task_id: f0828f8f-15fa-404d-b9c5-7f7ce484fb27
created: 2026-04-12
---

# Task Card: Dashboard KR5 阻断 Bug 清零 — 继续推进至可演示

## 根因分析（扫描结果）

**Bug 1：KR 进度数据错误（P0，阻断演示）**

- **现象**：LiveMonitor 和 Roadmap 两个页面中，KR1（AI自媒体线）显示 5%，KR2（AI私域线）显示 9%，ZenithJoy OKR 总进度约 39%（应为 77%）
- **根因**：`task-goals.js` 的 `KR_SELECT` SQL 没有返回 `key_results.progress` 列（即手动设置的进度百分比）。该列在 DB 中已设置：KR1/KR2 均为 100，但前端只能拿到 `current_value`（5 和 9，是实际发布条数，不是百分比）
- **涉及文件**：
  - `packages/brain/src/routes/task-goals.js`（后端）
  - `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx`（前端）
  - `apps/dashboard/src/pages/roadmap/RoadmapPage.tsx`（前端）

## 修复方案

1. **task-goals.js**：在 `KR_SELECT` 中添加 `COALESCE(progress, CASE WHEN target_value > 0 THEN ROUND(current_value::numeric / target_value::numeric * 100, 0) ELSE NULL END)::integer AS progress_pct`，在 `OBJ_SELECT` 中添加 `NULL::integer AS progress_pct`

2. **LiveMonitorPage**：OKR progress 计算优先使用 `g.progress_pct`

3. **RoadmapPage**：`normalizeGoalType` 优先使用 `g.progress_pct`

## 不做什么

- 不新增功能
- 不改样式
- 不改 DB schema（只修改 SELECT 查询）
