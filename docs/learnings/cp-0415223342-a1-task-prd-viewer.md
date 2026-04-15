# Learning: A1 — Task PRD Viewer

## 上下文

Day 2 Epic A 第一步。用户痛点：跟 Claude 对话讨论 PRD → 我注册到 Brain → 用户没有友好入口看。Plan Agent 原估 3h，探查后发现 Brain `GET /api/brain/tasks/:id` 已存在，scope 降到 1.5h。

## 实现要点

### DynamicRouter 已经支持 children
`apps/dashboard/src/components/DynamicRouter.tsx` 接受 `children?: React.ReactNode` 作为"额外的静态路由"，在 `<RoutesComp>` 内先于动态路由渲染。所以加新页面有两条路径：
- **动态**：往 navigation config 加（涉及 InstanceContext + Core 配置）
- **静态**：从 App.tsx 用 children 传 `<Route>`（极简，适合"通过 URL 访问、不进 navigation"的页面）

PRD viewer 选静态路径，是因为它从 PR body 链接进入，不需要在侧边栏出现。

### 复用现有 Brain endpoint
`GET /api/brain/tasks/:id` 已经返回完整 task object（含 description / payload / pr_url 等）。无需新建 endpoint，前端直接 fetch + 渲染。

### 不引入新依赖
package.json 没有 markdown 库（react-markdown / remark 都没有）。本期用 `<pre className="whitespace-pre-wrap">` 渲染——PRD 主要文本内容，单色块也够用。后续如需 syntax highlight 或 toc 再单独加 markdown 库。

### Worktree 测试基础设施陷阱
新 worktree 没有 `node_modules`，`npm install` 后 `npx vitest` 仍找不到（PATH 问题）。要用 `node node_modules/vitest/vitest.mjs run` 直接调或 `cd apps/dashboard; ./node_modules/.bin/vitest run`。

## 下次预防

- [ ] **新页面优先用 DynamicRouter children**（不进 navigation 的页面），而不是改 navigation config——后者需要协调 Core 配置发版
- [ ] **Markdown 库延迟引入**：先用 `<pre>` 顶住，等真有用户反馈说"PRD 太难读"再换 react-markdown，避免引入 deps 之后又要管 XSS、CSP、bundle size
- [ ] **复用已有 Brain endpoint**：80% 的"我们要这个数据"问题，Brain 已经有 endpoint 了；改 schema 前先 grep 一遍
- [ ] **Worktree 跑 dashboard 测试**：`cd apps/dashboard && node node_modules/vitest/vitest.mjs run` 是稳定姿势
