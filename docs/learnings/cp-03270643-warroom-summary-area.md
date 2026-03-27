# Learning: War Room Summary + Area 详情页架构

**分支**: cp-03270643-5265d872-af1a-4d96-ac40-1040d0
**日期**: 2026-03-27

## 背景

重构 War Room 从单页混合布局改为两层架构：总览页（Vision + Area 卡片）+ 详情页（Area 下 OBJ→KR→Task 三列）。

## 关键决策

1. **路由参数用 useParams**：GTDWarRoomArea 通过 `useParams<{ areaId: string }>()` 读取路由参数，与现有 ProjectDetail 保持一致。

2. **Area 级别导航**：总览页用 `window.history.pushState` + `PopStateEvent` 触发 React Router 路由更新，详情页用 `useNavigate` 返回总览页。

3. **数据不做后端改动**：所有 Area 数据从 `/api/tasks/full-tree?view=okr` 返回的全树中前端聚合，不增加新 API。

## 根本原因（CI 踩坑）

### L1 DoD Verification Gate 失败
**原因**：`成功标准` 章节使用了 `- [ ] text` checkbox 格式。`check-dod-mapping.cjs` 扫描整个文件中所有 checkbox 项，并要求每条都有 `Test:` 字段。`成功标准` 条目没有 Test 字段，导致 5 项映射失败。

### 下次预防

- [ ] `成功标准` 章节使用普通 bullet `- text`，**不要用** `- [ ]` checkbox 格式
- [ ] `验收条件（DoD）` 章节才使用带 checkbox 的格式，且每条必须有 `Test:` 字段
- [ ] Learning 文件在第一次 push 前就要创建好，不要推完 CI 失败再补
