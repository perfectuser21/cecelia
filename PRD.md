# Harness v2 M6 — Initiative Dashboard + 新建入口 + 飞书通知 + Report 模板

Status: IN_PROGRESS · Owner: Alex · Branch: cp-0420102609-harness-v2-m6-dashboard
Relates to: docs/design/harness-v2-prd.md §6.7 §6.9 §5.8

## 1. 背景

M1-M5 已把 Harness v2 的数据模型、Initiative Planner、合同 GAN、Task 循环和阶段 C E2E
全部落地。M6 补齐用户侧体验三件套：Initiative 级 Dashboard、飞书关键事件推送、
Initiative 级 Report 模板。本 PR 只做外层读/写 API 和前端视图，不碰 M1–M5 已完成的
核心编排逻辑（harness-graph.js / harness-initiative-runner.js / harness-final-e2e.js
的状态机不动）。

## 2. 范围

1. 新建 `packages/brain/src/routes/initiatives.js`：`GET /api/brain/initiatives/:id/dag`
   聚合 contracts + runs + subtasks + dependencies + cost + timing → 一次返回
2. 前端 `apps/dashboard/src/pages/harness/InitiativeDetail.tsx`：三阶段进度条 +
   Mermaid DAG + Task 卡片 + 成本面板 + E2E verdict
3. 路由 `/initiatives/:id` 在 `apps/api/features/system-hub/index.ts` 注册
4. `HarnessPipelinePage.tsx`：顶部「新建 Pipeline」按钮改成下拉两项
   （单 PR v1 · Initiative v2），Modal 要求 ≥100 字描述
5. 扩展 `packages/brain/src/notifier.js`：加 4 个 harness v2 通知函数
   （合同 APPROVED / Task PR merged / 阶段 C PASS|FAIL / 预算或超时预警）
6. `harness-report` SKILL.md 扩写 Initiative 级报告产出（4 个账号位置全部同步）

## 3. 非目标

- 不改 harness-graph.js / harness-initiative-runner.js 核心编排
- 不新增 migration
- 不起真实 docker-compose，测试一律 mock

## 成功标准

1. [ARTIFACT] `packages/brain/src/routes/initiatives.js` 存在且导出 Router
2. [ARTIFACT] `apps/dashboard/src/pages/harness/InitiativeDetail.tsx` 存在
3. [BEHAVIOR] `GET /api/brain/initiatives/:id/dag` 返回包含 phase / prd_content /
   contract_content / e2e_acceptance / tasks / dependencies / cost / timing 的 JSON
4. [BEHAVIOR] integration test `initiatives-dag-endpoint.integration.test.js` 通过
5. [BEHAVIOR] UI test `InitiativeDetail.test.tsx` 通过
6. [ARTIFACT] `packages/brain/src/notifier.js` 导出 4 个 harness v2 通知函数
7. [BEHAVIOR] unit test `notifier-harness-v2.test.js` 通过
8. [ARTIFACT] harness-report SKILL.md 含 "## Initiative 级 Report"（4 个账号位置）
9. [ARTIFACT] `apps/api/features/system-hub/index.ts` 注册 `/initiatives/:id` 路由

## 关联设计

- docs/design/harness-v2-prd.md
- packages/brain/src/routes/harness.js（Pipeline API 的姊妹读模型）
