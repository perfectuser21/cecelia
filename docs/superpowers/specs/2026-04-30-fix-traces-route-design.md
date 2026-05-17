# Fix /traces Route Missing — Design Spec

**日期**: 2026-04-30  
**分支**: cp-0430094016-fix-traces-route

## 问题

`apps/api/features/index.ts` 的 `coreFeatures` 映射缺少 `'system'` 条目，导致 `system/index.ts` 定义的所有路由（含 `/traces → TracesPage`）从未被加载进 React Router，访问 `/traces` 被 React Router 重定向回首页。

## 根因

PR #2690 正确写了 `apps/api/features/system/index.ts`（含 TracesPage 注册），但未同步把 `'system'` 加入 `features/index.ts` 的 `coreFeatures` 对象。

## 修复方案

**单行修改**：在 `features/index.ts` coreFeatures 中加入：
```ts
'system': () => import('./system'),
```

**部署**：修改后需重新 `npm run build`（apps/dashboard）并重启 cecelia-frontend 容器。

## 测试策略

- Trivial fix（< 5 行，无 I/O 逻辑）→ 验证方式：build 成功 + `curl http://localhost:5211/` 返回 200 + 浏览器打开 `/traces` 不跳转
- 无需新增单元测试（路由注册是框架行为，非函数逻辑）
