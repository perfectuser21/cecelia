---
id: qa-decision-cecelia-architecture
version: 1.0.0
created: 2026-02-04
prd: .prd-cecelia-architecture-upgrade.md
---

# QA Decision

**Decision**: MUST_ADD_RCI
**Priority**: P1
**RepoType**: Engine

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| task_type 字段存在且 routeTask 正确路由 | auto | brain/src/__tests__/tick.test.js |
| goals 状态流转正常 | auto | brain/src/__tests__/okr-tick.test.js |
| Autumnrice 能自动分类任务 | manual | manual:调用 /autumnrice 验证分类结果 |
| 前端显示 OKR 详情 | manual | manual:访问 /goals/:id 验证页面 |
| 前端显示日报 | manual | manual:访问 /daily-reports 验证页面 |
| 端到端测试 | manual | manual:创建需求 → 验证 OKR → Tasks → 路由 |

## RCI

**new**:
- C1-001: routeTask 根据 task_type 路由到对应 agent
- C2-001: OKR 状态从 ready → decomposing 触发规划师

**update**: []

## Reason

这是核心架构改动，涉及任务分类和路由逻辑。routeTask 是调度核心，必须有回归测试确保不同 task_type 能正确路由。OKR 状态机是新增功能，需要测试状态流转。前端页面是新增，首次用手动验证，后续可补充 E2E。

## Scope

**允许修改的范围**：
- `brain/src/tick.js` - 添加 routeTask 路由逻辑
- `brain/src/routes.js` - 添加新 API 端点
- `brain/src/okr-tick.js` - 新增 OKR Tick 模块
- `brain/src/nightly-tick.js` - 新增 Nightly Tick 模块
- `brain/src/__tests__/*.test.js` - 新增/更新测试
- `frontend/src/pages/GoalDetail.tsx` - 新增页面
- `frontend/src/pages/DailyReports.tsx` - 新增页面
- `~/.claude/skills/autumnrice/SKILL.md` - 更新 Skill
- `~/.claude/skills/repo-lead/SKILL.md` - 新增 Skill
- `docs/` - 文档更新

**禁止修改的区域**：
- `brain/src/executor.js` - 任务执行器（除非必要）
- 其他现有 API 端点逻辑（除非 task_type 相关）
