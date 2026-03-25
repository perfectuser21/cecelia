# Learning: Strategy Tree — OKR全链路可视化 + 进度API

**Branch**: cp-03242254-strategy-tree
**Date**: 2026-03-24

## 完成内容

构建了 OKR 全链路可视化系统：
1. 新建 `GET /api/brain/strategy-tree` 端点 — 返回 Area→Objective→KR→Project→Scope→Initiative→Tasks 完整树
2. 新建 `StrategyTree.tsx` 前端页面 — 可折叠树形结构，展示进度 rollup
3. 侧边栏加入「战略树」导航入口

### 根本原因

OKR 层级数据在 DB 中已完整（areas → objectives → key_results → okr_projects → okr_scopes → okr_initiatives → tasks），但没有端点把它们串联成树。

用户每次对话都要重新解释背景，因为没有任何可视化界面能一次展示完整的战略-执行链路。

现有 `/api/brain/okr/tree` 只到 KR 层，缺少 Project/Scope/Initiative/Task 四层，导致执行侧完全不可见，是根本缺口所在。

### 查询设计

使用 8 次批量查询（O(1)）而非 N+1：
1. 每层各查一次 ANY($ids)
2. 在 JS 内存中组装树结构
3. 避免了层级深时的性能问题

`/api/brain/okr/tree` 已有类似功能但只到 KR 层，本 PR 建了独立端点深入到 Task 层，不污染已有路由。

### 下次预防

- [ ] 检查是否有类似端点再动工，避免建重复轮子
- [ ] 前端树形组件层级超过 3 层时考虑虚拟滚动
- [ ] Initiative→Task 的 `okr_initiative_id` 目前很多为 null，需要在 /dev 流程里自动设置
