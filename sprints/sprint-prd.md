# Sprint PRD — InitiativeDetailPanel 静态测试 + 禁用模式验证（ws2）

## OKR 对齐

- **对应 KR**：Harness Pipeline 端到端可验证性（接续 ws3 InitiativeDetailPanel 实现）
- **本次推进预期**：为 InitiativeDetailPanel 补充 TDD 静态分析测试，涵盖 banned 模式检查

## 背景

ws3（PR #3106）在 `HarnessPipelinePage.tsx` 中新增了 `InitiativeDetailPanel` 组件，调用 `/api/brain/harness/initiative/:id/detail`。目前该组件无测试覆盖。本 sprint 补充 ws2 测试套件，验证组件结构正确且不含禁用模式（`planner_task_id` 被禁）。

## Golden Path（核心场景）

静态分析工具从 [读取 `HarnessPipelinePage.tsx` 源文件] → 经过 [grep 关键字段 + 禁用词扫描] → 到达 [所有断言通过，确认 detail 面板结构合规]

具体：
1. 读取 `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 文件内容
2. 验证 `InitiativeDetailPanel` 函数定义存在，含正确 data-testid 属性
3. 扫描 fetch URL 不含 `planner_task_id`（banned），且使用 `/initiative/${id}/detail` 路径

## Response Schema

N/A — 任务无 HTTP 响应（静态文件分析测试，无 endpoint）

## 边界情况

- 若 `InitiativeDetailPanel` 被重命名 → 测试应 fail（预期 fail，不是测试问题）
- 若 fetch URL 误加 `?planner_task_id=` → 应被 banned 扫描拦截

## 范围限定

**在范围内**：新增 `sprints/tests/ws2/initiative-detail-panel.test.ts`，静态分析 `HarnessPipelinePage.tsx` 中 `InitiativeDetailPanel`
**不在范围内**：实现 `/initiative/:id/detail` 后端端点；修改 `HarnessPipelinePage.tsx`；端到端 Playwright 测试

## 假设

- [ASSUMPTION: `InitiativeDetailPanel` 已在 `HarnessPipelinePage.tsx` 定义（由 ws3 实现）]
- [ASSUMPTION: 静态测试用 vitest，与 ws2 `ws-progress-ui.test.ts` 同框架]

## 预期受影响文件

- `sprints/tests/ws2/initiative-detail-panel.test.ts`: 新增测试文件

## journey_type: user_facing
## journey_type_reason: 测试目标是 Dashboard 组件（HarnessPipelinePage.tsx），属于用户界面层
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard 组件测试，遵循 ws2/ws3 合同先例（mac_web，本机 vitest 静态分析）
