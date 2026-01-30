# QA Decision - Phase 5.4 Nightly Planner

Decision: NO_RCI
Priority: P1
RepoType: Business

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| POST /api/system/plan/nightly | auto | tests/planning.test.ts |
| N8N workflow | manual | n8n UI verification |
| Dashboard TodayPlan | manual | visual verification |

## RCI

new: []
update: []

## Reason

Nightly Planner 是 Phase 5.3 的扩展，调用已有的 generatePlan 和 commitPlan。不涉及现有核心路径的回归。Dashboard 组件为新增UI。
