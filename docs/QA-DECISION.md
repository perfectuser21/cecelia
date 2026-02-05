---
id: qa-decision-feature-tick-system
version: 2.0.0
created: 2026-02-04
updated: 2026-02-05
prd: .prd-feature-tick-system.md
changelog:
  - 2.0.0: Feature Tick 系统实现
  - 1.0.0: 初始架构改动
---

# QA Decision: Feature Tick System

**Decision**: MUST_ADD_RCI
**Priority**: P0
**RepoType**: Engine

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| features 表创建成功 | auto | brain/src/__tests__/feature-tick.test.js |
| tasks 表新增字段正确 | auto | brain/src/__tests__/feature-tick.test.js |
| Feature Tick 检测 planning 状态 | auto | brain/src/__tests__/feature-tick.test.js |
| Feature Tick 检测 task_completed 状态 | auto | brain/src/__tests__/feature-tick.test.js |
| 调用秋米规划第一个 Task | auto | brain/src/__tests__/feature-tick.test.js |
| 防串线：feature_id 强绑定 | auto | brain/src/__tests__/anti-crossing.test.js |
| 防串线：active_task_id 状态锁 | auto | brain/src/__tests__/anti-crossing.test.js |
| 任务分流：按 task_type 分配 location | auto | brain/src/__tests__/task-router.test.js |
| Feature Tick 集成到主 Tick | auto | brain/src/__tests__/tick.test.js |
| 端到端：Single Task 直接执行 | manual | manual:创建 Single Task，验证执行完成 |
| 端到端：Feature 边做边拆 | manual | manual:创建 Feature，验证循环拆解 |

## RCI

**new**:
- C1-001: featureTick 检测 planning 状态的 Features 并调用 planFirstTask
- C1-002: featureTick 检测 task_completed 状态并调用 evaluateAndPlanNext
- C2-001: createTask 检查 Feature 无其他活跃 Task（防串线）
- C2-002: completeTask 校验 feature_id 一致性
- C3-001: identifyWorkType 正确识别 Single Task vs Feature
- C3-002: getTaskLocation 按 task_type 正确分配 location

**update**:
- tick.js: 集成 featureTick 调用

## Reason

Feature Tick 是核心调度机制，实现"边做边拆"的 Feature 执行模式。防串线机制保证同一 Feature 同时只有一个活跃 Task，避免并发冲突。任务分流确保 dev/review 任务在 US 执行，automation/data 任务在 HK 执行。

## Scope

**允许修改的范围**：
- `brain/migrations/003_feature_tick_system.sql` - 数据库迁移
- `brain/src/feature-tick.js` - Feature Tick 逻辑（新增）
- `brain/src/task-router.js` - 任务分流逻辑（新增）
- `brain/src/anti-crossing.js` - 防串线检查（新增）
- `brain/src/tick.js` - 集成 Feature Tick
- `brain/src/routes.js` - 添加新 API 端点
- `brain/src/__tests__/*.test.js` - 新增/更新测试

**禁止修改的区域**：
- `brain/src/executor.js` - 任务执行器（除非必要）
- `brain/src/decision.js` - 决策引擎
- 前端代码（本次不涉及）
