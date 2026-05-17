# Learning: 补注册 TaskTypeConfigPage import loader

**Branch**: cp-03221945-fix-task-type-config-loader
**Date**: 2026-03-22

## 背景

`/task-type-configs` 路由注册了但直接跳回首页，原因是 `components` 对象缺少对应 loader。

### 根本原因

新增页面时只在 `routes` 数组加了路径映射，忘记在 `components` 对象加 lazy import loader。
`DynamicRouter` 的 `getLazyComponent(name, corePageComponents)` 找不到 loader 时 `console.warn` 后返回 null，路由 fallback 到首页。

## 下次预防

- [ ] 新增 dashboard 页面时，必须同时做两件事：
  1. `routes` 数组加 `{ path, component }` 条目
  2. `components` 对象加 `ComponentName: () => import(...)` loader
- [ ] PR review checklist 加：routes 和 components 是否配对
