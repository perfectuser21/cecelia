# Pipeline v2 Overhaul

## 概述
将 Brain 的多步审查流程（Intent Expand → CTO Review → Code Quality → PRD Coverage Audit）
替换为统一的 Codex Gate 4 类型审查（prd_review, spec_review, code_review_gate, initiative_review）。

## Pipeline 阶段

### Pipeline 1: Codex Gate 路由注册 [已完成]
- 在 task-router.js 注册 4 个 Codex Gate task type
- 在 executor.js 注册 skillMap 和 US_ONLY_TYPES
- PR #1217

### Pipeline 2: /dev 4-Stage Pipeline 重构 [已完成]
- Engine /dev skill 重构为 4 阶段 pipeline
- PR #1212

### Pipeline 3: Brain 旧类型清理 [已完成]
- 删除 cto_review, code_quality_review, prd_coverage_audit 从所有注册表
- 删除 /request-cto-review API 端点
- 删除 decomp-check skill 目录
- 更新 execution-callback 使用通用审查类型集合
- 清理 model-registry 和 actions.js 中的旧引用

### Pipeline 4: initiative_execute 注册 [已完成]
- 注册 initiative_execute task type 到 task-router/executor/token-budget-planner

### Pipeline 5: 测试更新 [已完成]
- 更新 task-router-intent-cto.test.js（删除 cto_review 测试，新增 initiative_execute 测试）
- 更新 dispatch-now.test.js（替换 cto_review mock）
- 更新 fleet-dynamic-routing.test.js
- 更新 cto-review-callback.test.js（通用化描述）
