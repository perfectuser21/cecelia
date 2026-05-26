# /clips 静态路由修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `/clips` 路由被 catch-all 重定向到 `/`，将 ContentClipsPage/ContentClipDetailPage 注册为静态路由。

**Architecture:** 在 `apps/dashboard/src/App.tsx` 添加两个 lazy import 和两条 `<Route>`，与现有 TaskPrdPage/HarnessDetailPage 完全相同的模式，绕过 DynamicRouter 对 coreConfig 的依赖。

**Tech Stack:** React, React Router DOM, lazy/Suspense

---

## 文件清单

- Modify: `apps/dashboard/src/App.tsx`（第 13-15 行附近加 lazy import，第 292 行附近加 Route）
- Create: `docs/learnings/cp-0520222340-clips-static-route-fix.md`

---

### Task 1: 写失败测试（TDD commit-1）

**Files:**
- Test: 终端脚本（不新建文件，用 node -e 内联）

- [ ] **Step 1: 确认测试当前失败**

运行以下命令，确认 App.tsx 还没有 ContentClipsPage（当前应 exit 1 = 失败）：

```bash
cd /Users/administrator/worktrees/cecelia/clips-static-route-fix
node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('ContentClipsPage'))process.exit(1);console.log('PASS')"
```

Expected：进程 exit 1（无输出或 shell 报错）— 说明功能尚未实现。

- [ ] **Step 2: 为 TDD commit-1 创建 PRD 和 Learning 文件骨架**

创建 `PRD.md`（worktree 根目录）：

```bash
cat > /Users/administrator/worktrees/cecelia/clips-static-route-fix/PRD.md << 'EOF'
# /clips 静态路由修复

## 背景
Dashboard `/clips` 路由被 catch-all 重定向到 `/`，原因是 DynamicRouter 依赖 coreConfig 加载成功。

## 目标
将 ContentClipsPage/ContentClipDetailPage 注册为静态路由，与 TaskPrdPage/HarnessDetailPage 模式一致。

## DoD
- [x] `[ARTIFACT]` `apps/dashboard/src/App.tsx` 包含 ContentClipsPage lazy import
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('ContentClipsPage'))process.exit(1)"`
- [x] `[BEHAVIOR]` `/clips` 路由注册为静态路由（path="/clips" 在 App.tsx 存在）
  - Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('\"/clips\"'))process.exit(1)"`

## 成功标准
- `http://perfect21:5211/clips` 打开显示 Content Clips 列表页（不重定向到 /）
- `http://perfect21:5211/clips/:id` 打开显示 Clip 详情页
EOF
```

创建 Learning 文件骨架：

```bash
mkdir -p /Users/administrator/worktrees/cecelia/clips-static-route-fix/docs/learnings
cat > /Users/administrator/worktrees/cecelia/clips-static-route-fix/docs/learnings/cp-0520222340-clips-static-route-fix.md << 'EOF'
# Learning: /clips 静态路由修复

### 根本原因
DynamicRouter 所有路由依赖 coreConfig 加载成功。若 buildCoreConfig() 抛出异常，coreConfig=null，allRoutes=[]，catch-all 将所有路径重定向到 /。功能页（clips、PRD、harness）不属于配置驱动体系，应注册为静态路由。

### 下次预防
- [ ] 新增功能页时，先判断是否需要动态配置：如果是"总是可访问"的功能页，直接加到 App.tsx 静态路由，不进 navigation.config/system-hub。
- [ ] 参考模式：TaskPrdPage/HarnessDetailPage/ContentClipsPage 均为静态路由。
EOF
```

- [ ] **Step 3: commit-1（仅失败状态的 DoD + Learning 骨架）**

```bash
cd /Users/administrator/worktrees/cecelia/clips-static-route-fix
git add PRD.md docs/learnings/cp-0520222340-clips-static-route-fix.md
git commit -m "test: add DoD + learning for clips static route fix (failing)"
```

---

### Task 2: 实现静态路由（TDD commit-2）

**Files:**
- Modify: `apps/dashboard/src/App.tsx`

- [ ] **Step 1: 添加 lazy import**

打开 `apps/dashboard/src/App.tsx`，在第 15 行（`const HarnessDetailPage = lazy(...)` 这行之后）添加：

```tsx
// clips: 静态路由，不依赖动态配置加载
const ContentClipsPage = lazy(() => import('./pages/clips/ContentClipsPage'));
const ContentClipDetailPage = lazy(() => import('./pages/clips/ContentClipDetailPage'));
```

完整上下文（第 13-18 行变为）：

```tsx
const TaskPrdPage = lazy(() => import('./pages/tasks/TaskPrdPage'));
// ws4: HarnessDetailPage — /harness/:id initiative 实时 Streaming 详情页
const HarnessDetailPage = lazy(() => import('./pages/harness/HarnessDetailPage'));
// clips: 静态路由，不依赖动态配置加载
const ContentClipsPage = lazy(() => import('./pages/clips/ContentClipsPage'));
const ContentClipDetailPage = lazy(() => import('./pages/clips/ContentClipDetailPage'));
```

- [ ] **Step 2: 添加 Route 元素**

在同文件 DynamicRouter children 中，找到 HarnessDetailPage 的 Route（约第 285-292 行）：

```tsx
            {/* ws4: HarnessDetailPage — /harness/:id initiative 实时 Streaming 详情页 */}
            <Route
              path="/harness/:id"
              element={
                <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading…</div>}>
                  <HarnessDetailPage />
                </Suspense>
              }
            />
```

在这段之后、`</DynamicRouter>` 之前插入：

```tsx
            {/* clips: Content Clips 管理页 — 静态路由，不依赖 coreConfig */}
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

- [ ] **Step 3: 验证测试通过**

```bash
cd /Users/administrator/worktrees/cecelia/clips-static-route-fix
node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('ContentClipsPage'))process.exit(1);console.log('PASS ContentClipsPage import')"
node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('\"/clips\"'))process.exit(1);console.log('PASS /clips route')"
```

Expected：两行均输出 `PASS ...`，exit 0。

- [ ] **Step 4: 更新 PRD DoD 为全部 [x]**

确认 `PRD.md` 中所有条目已是 `[x]`（上面创建时已是 [x]，核查无误）。

- [ ] **Step 5: commit-2（实现）**

```bash
cd /Users/administrator/worktrees/cecelia/clips-static-route-fix
git add apps/dashboard/src/App.tsx PRD.md
git commit -m "fix(dashboard): add /clips static routes to bypass dynamic routing (#3067 follow-up)"
```

---

### Task 3: 重建 Dashboard + 人工验证

**Files:**
- Build output: `apps/dashboard/dist/`

- [ ] **Step 1: 重建 Dashboard**

```bash
cd /Users/administrator/worktrees/cecelia/clips-static-route-fix
npm run build --workspace=apps/dashboard 2>&1 | tail -10
```

Expected：看到 `dist/index.html` 和新的 `.js` chunk 文件，无 ERROR。

- [ ] **Step 2: 同步 dist 到主仓库（worktree 共享文件系统，直接可用）**

Dashboard 容器挂载的是主仓库的 dist 目录。需要将 worktree 的 dist 同步过去：

```bash
cp -r /Users/administrator/worktrees/cecelia/clips-static-route-fix/apps/dashboard/dist/* \
      /Users/administrator/perfect21/cecelia/apps/dashboard/dist/
```

- [ ] **Step 3: 验证页面可访问**

```bash
curl -s -o /dev/null -w "%{http_code}" "http://perfect21:5211/clips"
```

Expected：`200`（不是 3xx 重定向）

- [ ] **Step 4: commit dist + 完成 Learning**

```bash
cd /Users/administrator/worktrees/cecelia/clips-static-route-fix
git add apps/dashboard/dist/
git commit -m "build(dashboard): rebuild dist with /clips static routes"
```
