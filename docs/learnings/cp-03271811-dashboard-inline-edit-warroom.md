# Learning: Dashboard inline 编辑 + War Room 页面

**Branch**: cp-03271811-dashboard-inline-edit-warroom
**Task**: a1bb8fb1-86da-47ab-b65b-d9f0f82e7605

### 根本原因

本次实现了三个功能：
1. GTDOkr 页面 Vision/Objective/KR title inline 双击编辑
2. GTDProjects 页面 Project/Initiative name inline 双击编辑
3. GTDWarRoom 新页面（作战室）

### 关键实现

- **TitleEditor 组件**（GTDOkr.tsx）：可复用的 inline 编辑组件，双击切换 input，onBlur/Enter 保存，Escape 取消，调用 PATCH `/api/tasks/full-tree/:nodeType/:id`
- **NameCell 组件**（GTDProjects.tsx）：同样模式，调用 PATCH `/api/tasks/okr-projects/:id`
- **GTDWarRoom**：拉取 OKR 树 + Brain in_progress 任务，展示 Vision → Objectives+KR → Tasks 全景

### 下次预防

- [ ] Node v25 使用 `--input-type=commonjs` heredoc 方式运行 inline 脚本，避免 TypeScript 模式下 `!` 被转义
- [ ] `node -e "..."` 命令中的 `!` 需要特别注意 shell 转义，改用 heredoc 更安全
- [ ] DoD Test 命令不能含单引号内的 `!`（shell history expansion），用 heredoc 或双引号+转义
- [ ] 新路由需在 `index.ts` 三处同时注册：navItem children、routes 数组、components map
