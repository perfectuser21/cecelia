# Learning: 数据闭环 v1 — 周报 Dashboard 集成完善

**Branch**: cp-04080714-4b9de070-0ac5-4168-8d85-b86061
**Date**: 2026-04-08

---

### 根本原因

任务说"进度0%"，但实际上 weekly-report-generator.js、Dashboard 报告页面、system-reports API 均已完整实现。真正的缺口是：
1. `/reports` 页面路由存在但未加入导航菜单 children，导致页面不可发现
2. ReportsListPage 只有 48h_system_report 的"手动生成"按钮，缺少周报手动触发入口

### 下次预防

- [ ] 新增 Dashboard 页面时，同步检查 `system-hub/index.ts` 的 navItem.children 是否包含对应路由
- [ ] 当 Brain 任务状态为"进度0%"但代码中明显有大量已实现代码时，先做代码探索评估真实缺口，避免重复实现
- [ ] 手动触发类功能（如周报生成）应同步在 UI 层提供入口，不只依赖 tick 自动触发
