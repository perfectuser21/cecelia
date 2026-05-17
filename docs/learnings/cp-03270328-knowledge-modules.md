# Learning: Knowledge Modules 页面接入 Dashboard

**分支**: cp-03270328-39a6e137-4890-4317-a2bd-d981cb
**日期**: 2026-03-27

## 背景

将西安生成的 86 个知识模块页接入 Dashboard，新增 `/knowledge/modules` 列表页和详情页，Brain API 从 BACKLOG.yaml 读取数据。

### 根本原因

任务本身无 bug，这是新功能开发。Learning 记录流程陷阱。

## 踩坑记录

### 1. Branch-protect Hook 三连拦截
- **PRD 文件**：`packages/` 子目录开发需要 per-branch PRD（`.prd-cp-{branch}.md`），全局 `.prd.md` 不够
- **DoD 文件**：需要 `.dod-cp-{branch}.md` per-branch DoD
- **tasks_created**：`.dev-mode` 必须包含 `tasks_created: true`

**下次预防**: 进入 worktree 后立即创建三个文件：`.prd-{branch}.md`、`.dod-{branch}.md`、在 `.dev-mode` 中加 `tasks_created: true`。

### 2. DoD 条目必须全部勾选 `[x]` 才能通过 L1 CI
- DoD 文件写了但保留 `[ ]`，CI 报"未验证项检查失败"
- `check-dod-mapping.cjs` 会扫描所有 `- [ ]`，发现未勾选就失败

**下次预防**: Stage 2 完成本地验证后立即把所有 DoD 条目改为 `[x]`，commit 时一并提交。

### 3. verify-step.sh 要求 `tdd_red_confirmed: true`
- 标记 `step_2_code: done` 时被 bash-guard Hook 拦截
- 需要先在 `.dev-mode` 写 `tdd_red_confirmed: true`

**下次预防**: Stage 2 开始时同步追加 `tdd_red_confirmed: true` 到 `.dev-mode`。

## 架构确认

- Dashboard 页面组件放在 `apps/api/features/<feature>/pages/`（不是 `apps/dashboard/`）
- 配置驱动路由：在 `apps/api/features/<feature>/index.ts` 注册 routes + components + navItem
- Brain API 新增路由：在现有 router 文件用 `router.get('/new-path', ...)` 追加，不另建文件

## DoD 模板复用清单

- [ ] `.prd-{branch}.md` 在根目录创建（packages/ 子目录开发必须）
- [ ] `.dod-{branch}.md` 在根目录创建
- [ ] `.dev-mode` 包含 `tasks_created: true`、`tdd_red_confirmed: true`
- [ ] DoD 条目完成后改为 `[x]` 再 commit
