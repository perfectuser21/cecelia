# Learning: Dashboard 内容工厂触发页

**Branch**: cp-03190100-content-factory
**Date**: 2026-03-19

## 实现摘要

在 `apps/api/features/content/pages/ContentFactory.tsx` 新增内容工厂触发页，在 `apps/api/features/knowledge/index.ts` 注册路由 `/content-factory` 并加入 execution 导航组。

页面三个功能：
1. 从 `/api/brain/content-types` 读取内容类型列表 → 下拉选择
2. 输入关键词 + 点击启动 → POST `/api/brain/pipelines`
3. GET `/api/brain/pipelines` 展示已有 Pipeline 列表及状态

### 根本原因

Brain Content Pipeline API（PR #1101）已就绪，但 Dashboard 没有入口页面，用户无法触发 Pipeline。

### 关键决策

1. **注册到 knowledge feature**：内容工厂属于内容生产范畴，归到 knowledge 特性，在 execution 导航组显示
2. **纯 fetch 不用 useApi**：操作型页面（提交表单 + 刷新列表），直接用 fetch 而非缓存型 useApi hook
3. **`useCallback` 稳定依赖**：`loadContentTypes` 不依赖 `contentType`（用函数式更新 `setContentType(prev => prev || data[0])`），避免 ESLint 循环依赖警告

### 下次预防

- [ ] 新增页面必须同时在 feature manifest 中注册 `route` + `component`，缺一不可
- [ ] 导航组 (`navItem.group`) 必须引用已存在的 navGroup id（来自同 feature 或其他 feature 的 navGroups）
- [ ] `useCallback` 依赖数组要精确——用 `setContentType(prev => ...)` 可以避免把 state 本身加入 deps
