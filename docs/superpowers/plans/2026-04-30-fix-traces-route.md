# Fix /traces Route Missing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `coreFeatures` 加入 `system` feature 条目，让 `/traces` 路由被 React Router 正确注册，重新 build dashboard 后验证页面可访问。

**Architecture:** `features/index.ts` 是 feature manifest 的 SSOT，它的 `coreFeatures` 对象决定哪些 feature 的路由和组件会被加载。`system/index.ts` 已完整定义 TracesPage 路由，只需加一行 import 映射，build 后即生效。

**Tech Stack:** TypeScript, Vite (dashboard build), Docker (cecelia-frontend container)

---

### Task 1: 加 system 条目 + 验证 build

**Files:**
- Modify: `apps/api/features/index.ts:9-22`

- [ ] **Step 1: 加 system 条目**

修改 `/Users/administrator/worktrees/cecelia/fix-traces-route/apps/api/features/index.ts`，将：

```ts
// Feature manifests - 11 entries
export const coreFeatures = {
  'dashboard': () => import('./dashboard'),
  'inbox': () => import('./inbox'),
  'gtd': () => import('./gtd'),
  'planning': () => import('./planning'),
  'today': () => import('./today'),
  'work': () => import('./work'),
  'execution': () => import('./execution'),
  'knowledge': () => import('./knowledge'),
  'system-hub': () => import('./system-hub'),
  'profile': () => import('./profile'),
  'cecelia': () => import('./cecelia'),
};
```

改为：

```ts
// Feature manifests - 12 entries
export const coreFeatures = {
  'dashboard': () => import('./dashboard'),
  'inbox': () => import('./inbox'),
  'gtd': () => import('./gtd'),
  'planning': () => import('./planning'),
  'today': () => import('./today'),
  'work': () => import('./work'),
  'execution': () => import('./execution'),
  'knowledge': () => import('./knowledge'),
  'system-hub': () => import('./system-hub'),
  'system': () => import('./system'),
  'profile': () => import('./profile'),
  'cecelia': () => import('./cecelia'),
};
```

- [ ] **Step 2: commit-1（仅逻辑修改，无测试）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-traces-route
git add apps/api/features/index.ts
git commit -m "fix(dashboard): 注册 system feature — /traces 路由缺失修复"
```

Expected: commit 成功

- [ ] **Step 3: rebuild dashboard**

```bash
cd /Users/administrator/perfect21/cecelia/apps/dashboard
npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`（无 TypeScript 报错）

- [ ] **Step 4: 重启 cecelia-frontend 容器**

```bash
cd /Users/administrator/perfect21/cecelia
docker compose up -d frontend
sleep 3
docker logs cecelia-frontend 2>&1 | tail -5
```

Expected: 日志显示 `Frontend proxy running on http://localhost:5211`，无 ENOENT 错误

- [ ] **Step 5: smoke 验证**

```bash
# 首页
curl -s -o /dev/null -w "%{http_code}" http://localhost:5211/
# /traces SPA 路由
curl -s -o /dev/null -w "%{http_code}" http://localhost:5211/traces
# langfuse 数据 via proxy
curl -s "http://localhost:5211/api/brain/langfuse/recent?limit=2" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d['success'] and d['count']>0 else 'FAIL')"
```

Expected：
- 首页 → `200`
- /traces → `200`（SPA fallback 返回 index.html）
- langfuse → `ok`
