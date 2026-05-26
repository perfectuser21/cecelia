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
