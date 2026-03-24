# Learning: Strategy Tree — OKR全链路可视化 + 进度API

## 任务概述

为 Cecelia 实现 `GET /api/brain/strategy-tree` Brain 端点和前端 StrategyTree.tsx 页面，提供 Area → Objective → KR → Project → Scope → Initiative → Tasks 完整可视化树。

### 根本原因

OKR 数据分散在 7 张表中，缺乏统一的聚合 API 和可视化入口，导致用户每次对话都需要重新解释项目背景。

### 实现要点

- 后端：逐层查询 7 张表，自下而上 rollup 计算 total_tasks/completed_tasks/progress
- 前端：可折叠树形组件，默认展开到 KR 层，Initiative 展开显示 Task 列表
- completedStatuses = `done/completed/merged/shipped`（与 Brain 任务状态对齐）

### 下次预防

- [ ] 在写 strategy-tree.js 前先确认各表的外键关系（areas→objectives 用 area_id，objectives→key_results 用 objective_id 等）
- [ ] 写 per-branch `.dev-mode.*` 文件时必须包含 `tasks_created: true`，否则 branch-protect hook 会阻止代码写入
- [ ] Pipeline rescue 需先检查 `.dev-mode.*` per-branch 文件（优先级高于 `.dev-mode`）
