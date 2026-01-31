---
id: qa-decision-kr2-advance
version: 1.1.0
created: 2026-02-01
updated: 2026-02-01
changelog:
  - 1.1.0: 修正测试引用（.ts → .js，auto → manual），RCI 决策改为 NO_RCI（调查任务）
  - 1.0.0: 初始版本（KR2 PRD/TRD 生成验证与修复）
---

# QA Decision

Decision: NO_RCI
Priority: P0
RepoType: Business

Tests:
  - dod_item: "找到 Brain 中 PRD/TRD 生成的代码位置，定位到具体文件和函数"
    method: manual
    location: manual:检查 apps/core/src/brain/templates.js 和 planner.js，确认 generateTrdFromGoalKR 或相关函数存在

  - dod_item: "手动测试生成功能：创建测试 Goal，验证生成的 TRD 包含 title、requirements、success_criteria"
    method: manual
    location: manual:创建测试 Goal 并验证生成结果

  - dod_item: "运行自动化测试，90% 以上通过率"
    method: auto
    location: apps/core/src/brain/__tests__/*.test.js

  - dod_item: "查看 Brain decision_log，找到最近 10 次 'Advance KR2' 相关的失败记录"
    method: manual
    location: manual:查询 Core API `/api/brain/decisions` 或直接查询 decision_log 表

  - dod_item: "识别共同失败模式：记录错误堆栈、错误消息、失败步骤到文档"
    method: manual
    location: manual:分析日志并记录到 docs/KR2-FAILURE-ANALYSIS.md

  - dod_item: "定位根本原因：确定是代码 bug、配置问题、依赖缺失还是逻辑错误"
    method: manual
    location: manual:代码审查和调试分析

  - dod_item: "如果发现代码 bug，修复后重新测试通过"
    method: manual
    location: manual:修复后重新运行相关测试验证

  - dod_item: "如果是配置问题，更新配置并验证"
    method: manual
    location: manual:检查配置文件和环境变量

  - dod_item: "添加或修复相关单元测试，确保覆盖失败场景"
    method: manual
    location: manual:检查 apps/core/src/brain/__tests__/templates.test.js，验证包含失败场景测试用例

  - dod_item: "使用 Brain API 更新失败任务状态为 completed"
    method: manual
    location: manual:验证 API 调用响应 200

  - dod_item: "验证 `GET /api/brain/status` 中 p0 任务列表不再包含 'Advance KR2' 的 failed 任务"
    method: manual
    location: manual:检查 API 响应中 p0 数组

  - dod_item: "确认 Brain system_health 中 stale_tasks = 0"
    method: manual
    location: manual:检查 status 响应中的 system_health 字段

  - dod_item: "如果 KR2 确实已完成，验证功能正常工作"
    method: manual
    location: manual:端到端验证 PRD/TRD 生成流程

  - dod_item: "如果 KR2 未完成，更新 Brain 中的 KR2 progress 为正确值"
    method: manual
    location: manual:验证 API 更新结果

  - dod_item: "记录验证结果到文档 `docs/KR2-VERIFICATION.md`"
    method: manual
    location: manual:检查文件是否存在且包含验证结果

  - dod_item: "相关单元测试通过（如果有修改代码）"
    method: auto
    location: apps/core/src/brain/__tests__/*.test.js

RCI:
  new: []
  update: []

Reason: P0 核心功能验证任务。本任务为调查分析性质，重点是验证现有功能状态和清理失败任务，不涉及新功能开发，因此不新增 RCI。如果发现 bug 需要修复，将在修复 PR 中评估是否需要添加回归契约。
