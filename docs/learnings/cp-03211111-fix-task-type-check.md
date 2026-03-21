# Learning: 修复 tasks 表 CHECK 约束

## 背景
tasks 表的 task_type CHECK 约束缺少 `pipeline_rescue` 和 `content_publish`，导致 decomp-checker 创建任务失败。

### 根本原因
新增 task_type 时（在 executor.js/task-router.js 中注册），遗漏了同步更新数据库 CHECK 约束。migration 165/167 分别加了 Pipeline v2 Gate 类型和 Scope 层类型，但 pipeline_rescue（PR #1244 引入）和 content_publish（发布系统引入）未同步。

### 下次预防
- [ ] 新增 task_type 到 executor.js 或 task-router.js 时，同时创建 migration 更新 CHECK 约束
- [ ] facts-check.mjs 应增加 CHECK 约束与代码中 task_type 的交叉校验
- [ ] 考虑将 CHECK 约束改为从 task-router.js 的列表动态生成
