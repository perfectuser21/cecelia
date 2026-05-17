# Learning: content_publish 路由缺失导致发布链路断裂

**分支**: cp-04030356-736f933e-39b5-4645-b1be-a62fc9  
**日期**: 2026-04-03

### 根本原因

内容工厂 Pipeline 的 6 步流程（research→copywriting→copy-review→generate→image-review→export）已在 `content-pipeline-orchestrator.js` 中实现，export 完成后会创建 8 个 `content_publish` 子任务（每个平台一个）。

但 `task-router.js` 中遗漏了 `content_publish` 的三处注册：
- `VALID_TASK_TYPES` 未包含 → `detectRoutingFailure` 拒绝该任务类型
- `LOCATION_MAP` 未配置 → 执行位置未知（publisher skills 需要 US Mac + CDP 浏览器）
- `TASK_REQUIREMENTS` 未配置 → 能力路由失败

此外，`DEFINITION.md` 未包含 `sprint_*` 和 `content-*` 系列任务类型，导致 `facts-check.mjs` 持续告警。

### 修复

1. `task-router.js`：在三处添加 `content_publish`
   - `VALID_TASK_TYPES` → 允许该类型通过路由验证
   - `LOCATION_MAP['content_publish'] = 'us'` → publisher skills 在 US Mac 运行
   - `TASK_REQUIREMENTS['content_publish'] = ['has_browser']` → 需要 CDP 浏览器能力
2. `DEFINITION.md`：补充 sprint_generate/sprint_evaluate/sprint_fix 和所有 content-* 任务类型文档

### 下次预防

- [ ] 新增任务类型时，必须同时更新 task-router.js 的三处（VALID_TASK_TYPES + LOCATION_MAP + TASK_REQUIREMENTS）
- [ ] 新增任务类型时，同步更新 DEFINITION.md 任务类型表格
- [ ] facts-check.mjs 会自动检测 LOCATION_MAP vs DEFINITION.md 的不一致，PR 前必须通过
- [ ] 涉及多阶段 Pipeline 时，确认终止阶段（export）创建的子任务类型也已注册
