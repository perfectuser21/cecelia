# Learning: MiniMax 路由清理 + content-* AFFINITY 补全

**分支**: cp-03241445-fix-minimax-routing-content-affinity
**合并时间**: 2026-03-24

### 根本原因

task-router.js 路由决策和 token-budget-planner.js 执行器亲和性是两个独立的配置。当 MiniMax 被停用时，只更新了 task-router.js 的 LOCATION_MAP，但遗漏了 token-budget-planner.js 的 EXECUTOR_AFFINITY。
content-* 任务类型在 VALID_TASK_TYPES 和 executor.js skillMap 中注册，但从未加入 EXECUTOR_AFFINITY，导致默认走 claude 而非预期的西安 codex。
两处配置之间没有自动一致性检查，导致路由逻辑发散。

### 下次预防

- [ ] 停用一个执行器类型时，同时搜索并更新所有引用该执行器名称的文件（task-router.js + token-budget-planner.js）
- [ ] 新增 task_type 时，必须同时在 EXECUTOR_AFFINITY 中定义路由策略（不能依赖 DEFAULT_AFFINITY 兜底）
- [ ] 考虑为 EXECUTOR_AFFINITY 和 LOCATION_MAP 添加一致性检查脚本
