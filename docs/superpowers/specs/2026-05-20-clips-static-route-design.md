# /clips 静态路由修复设计

**Goal:** 修复 Dashboard `/clips` 路由被 catch-all 重定向到 `/` 的问题，使 Content Clips 管理页可正常访问。

**Architecture:** 在 `apps/dashboard/src/App.tsx` 将 ContentClipsPage/ContentClipDetailPage 注册为静态路由，与 TaskPrdPage/HarnessDetailPage 完全相同的模式，绕过动态路由对 coreConfig 的依赖。

**Tech Stack:** React, React Router DOM, lazy/Suspense

---

## 根因分析

DynamicRouter 依赖 `coreConfig` 加载成功才能生成路由表。若 `buildCoreConfig()` 抛出异常，`loadCoreConfig()` 返回 null，`allRoutes` 为空，catch-all `path="*"` 将所有路径重定向到 `/`。`/clips` 是功能性管理页，不属于"配置驱动"路由体系，应与 TaskPrdPage/HarnessDetailPage 同级处理。

## 方案

**静态路由注入（App.tsx）**

修改文件：`apps/dashboard/src/App.tsx`

1. 在现有静态路由 lazy import 后添加：
   ```tsx
   const ContentClipsPage = lazy(() => import('./pages/clips/ContentClipsPage'));
   const ContentClipDetailPage = lazy(() => import('./pages/clips/ContentClipDetailPage'));
   ```

2. 在 DynamicRouter children 中（HarnessDetailPage Route 后）添加：
   ```tsx
   <Route
     path="/clips"
     element={
       <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading…</div>}>
         <ContentClipsPage />
       </Suspense>
     }
   />
   <Route
     path="/clips/:id"
     element={
       <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading…</div>}>
         <ContentClipDetailPage />
       </Suspense>
     }
   />
   ```

## 测试策略

分类：trivial（< 20 行，无 I/O，纯路由声明）

- `[BEHAVIOR]` DoD 测试：`manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('/clips'))process.exit(1)"`
- 人工验证：浏览器打开 `http://perfect21:5211/clips`，页面正常加载（不重定向）

## 成功标准

- `http://perfect21:5211/clips` 打开显示 Content Clips 列表页（不重定向到 /）
- `http://perfect21:5211/clips/:id` 打开显示 Clip 详情页
- 不影响现有路由（TaskPrdPage/HarnessDetailPage 正常）
