# Sprint PRD

## 产品目标

Brain 任务列表 API 目前不支持按 sprint_dir 过滤，开发者和自动化流水线在查询某次 Sprint 运行产生的任务时，只能拉全量再客户端过滤，效率低。
本 Sprint 为 `GET /api/brain/tasks` 新增 `sprint_dir` 查询参数，让调用方可以直接获取属于某个 Sprint 目录的任务集合。
目标用户：Harness 自动化流水线（Evaluator/Report 阶段）以及开发者手动排查 Sprint 结果。

## 功能清单

- [ ] Feature 1: 按 sprint_dir 过滤任务列表
- [ ] Feature 2: sprint_dir 参数缺失时行为与原有逻辑一致（不破坏现有调用方）
- [ ] Feature 3: 返回结果包含完整任务字段（与原有任务列表结构相同）

## 验收标准（用户视角）

### Feature 1
- 调用方传入 `sprint_dir=sprints/run-20260407-2353`，只看到 `sprint_dir` 字段等于该值的任务，不会混入其他 Sprint 的任务
- 传入不存在的 sprint_dir 时，返回空数组而非报错

### Feature 2
- 不传 `sprint_dir` 时，接口返回与之前完全相同，原有调用方无感知变化
- 其他已有过滤参数（`status`、`limit` 等）与 `sprint_dir` 可以组合使用，结果是两个条件同时满足的任务

### Feature 3
- 返回的每条任务包含 `id`、`title`、`status`、`sprint_dir` 等完整字段，调用方无需二次查询

## AI 集成点（如适用）

无。本功能为纯数据过滤，不涉及 AI 能力。

## 不在范围内

- 不修改任务创建逻辑（不自动填充 sprint_dir 字段）
- 不新增 sprint_dir 索引优化（数据量小，不需要）
- 不涉及前端 Dashboard 展示变更
- 不支持 sprint_dir 模糊匹配或通配符查询
