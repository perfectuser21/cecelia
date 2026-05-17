# Learning: Harness Pipeline 可视化页面

**Branch**: cp-04112000-harness-pipeline-dashboard  
**Date**: 2026-04-11

### 根本原因

在 worktree 中开发时，如果 Brain 派发的任务用了非标准格式的分支名（如 `cp-0411195530-xxx`，10位数字而非8位），会导致 `branch-protect.sh` 正则匹配失败（要求 `^cp-[0-9]{8}-[a-z0-9]...`），所有代码写入被阻断。

### 具体问题

1. Brain 派发任务时使用的分支名 `cp-0411195530-harness-pipeline-dashboard` 含 10 位时间戳，不符合 8 位格式
2. Hook 正则 `^cp-[0-9]{8}-[a-z0-9][a-z0-9_-]*$` 严格要求 8 位
3. 需要手动切到符合规范的分支 `cp-04112000-harness-pipeline-dashboard`

### 下次预防

- [ ] Brain 派发任务时应确保生成 8 位时间戳格式（`MMDDHHNN`），不要用 10 位
- [ ] 接到任务后，第一步检查分支名是否符合 `cp-[0-9]{8}-` 格式，若不符合立即切分支

### 技术知识

- Dashboard 路由通过 `apps/api/features/*/index.ts` 的 FeatureManifest 注册，三处要改：
  1. `navGroups` 的 `children` 数组（导航菜单项）
  2. `routes` 数组（路由配置）
  3. `components` 对象（懒加载组件映射）
- `/api/brain/tasks?task_type=X&planner_task_id=Y` 支持双参数过滤，可高效查子任务
- 测试文件应写纯函数测试，不依赖 DOM/React，可用主仓库 vitest 直接运行
