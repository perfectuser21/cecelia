# PRD: 清理 Brain 垃圾派发路径 + 注册 Codex Gate 路由

## 背景
当前 Brain 有三条派发路径并存（pr_plans / initiative_plan / area_stream），5 个审查任务类型重叠。需要：
1. 注册 4 个新 Gate 任务类型的路由（prd_review / spec_review / code_review_gate / initiative_review）
2. 删除旧的 initiative_plan 边跑边规划路径（decomposition-checker.js 中的相关函数）
3. 在 Area Stream 路径中加注释说明其独立用途

## 具体需求

### 1. task-router.js
- VALID_TASK_TYPES 新增 4 个 Gate 类型
- SKILL_WHITELIST 新增 4 个 Gate 路由
- LOCATION_MAP 新增 4 个 Gate 路由（均为 us）

### 2. executor.js
- skillMap 新增 4 个 Gate 类型映射
- US_ONLY_TYPES 新增 4 个 Gate 类型
- 新增 initiative_review 的特殊命令构建逻辑

### 3. decomposition-checker.js
- 删除 hasExistingInitiativePlanTask() 函数
- 删除 createInitiativePlanTask() 函数
- 删除 checkReadyKRInitiatives() 中为无活跃 Task 的 Initiative 创建 initiative_plan 的逻辑
- 保留 KR 状态流转逻辑和 KR 完成检查

### 4. token-budget-planner.js
- EXECUTOR_AFFINITY 新增 4 个 Gate 类型（primary: codex）

### 5. pre-flight-check.js
- SYSTEM_TASK_TYPES 新增 4 个 Gate 类型

### 6. planner.js
- Area Stream 路径保留，加注释说明独立用途

## 成功标准
- 4 个新 Gate 类型在 task-router / executor / token-budget-planner / pre-flight-check 中都已注册
- decomposition-checker.js 中 initiative_plan 相关代码已清理
- 旧路由暂不删除（保证向后兼容）
