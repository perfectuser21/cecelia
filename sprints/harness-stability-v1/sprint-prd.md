# Sprint PRD — Harness 稳定性 v1（可视化 + CI 白名单 + Report 重试）

## 背景

Harness pipeline 审计发现三个问题：
1. Dashboard 完全看不到 Harness pipeline 运行状态（无面板、无组件、零可见性）
2. Proposer 生成的合同可能包含 `npx playwright` 等命令，但 CI 白名单只有 `node/npm/npx/curl/bash/psql`，`playwright` 不在其中——Proposer 写出的合同到 CI 阶段必然失败
3. harness_report skill 没有任何重试机制，一次失败就丢失整个 sprint 的报告

## 目标

让 Harness pipeline 可观测、CI 合同校验一致、报告生成具备容错能力。

## 功能列表

### Feature 1: Dashboard Harness Pipeline 面板

**用户行为**: 用户在 Dashboard 导航中看到"Harness"入口，点击进入后查看所有 harness sprint 的运行状态
**系统响应**: 面板展示 sprint 列表，每个 sprint 显示当前阶段（Planner / Proposer / Reviewer / Generator / Evaluator / Report）、GAN 轮次、CI 状态、最终 verdict
**不包含**: 不做 sprint 的创建/编辑/触发操作（只读面板），不做实时 WebSocket 推送

### Feature 2: CI 白名单同步 — playwright 加入

**用户行为**: Proposer 在合同中写 `manual:npx playwright test ...` 类型的验证命令
**系统响应**: CI 白名单校验通过，不再因命令不在白名单而 block
**不包含**: 不改变白名单的整体策略（仍然是显式枚举），不增加其他非标准命令

### Feature 3: harness_report 失败重试

**用户行为**: harness_report 执行时因临时原因（网络/API 超时/文件锁）失败
**系统响应**: 自动重试最多 3 次，每次间隔递增；3 次均失败后标记 verdict 为 REPORT_FAILED 并保留已收集的部分数据
**不包含**: 不做 report 内容的增量恢复（每次重试从头生成），不重试非 report 阶段的失败

## 成功标准

- Dashboard `/harness` 页面可渲染，展示至少一条 sprint 记录的阶段信息
- `npx playwright` 命令通过 `check-manual-cmd-whitelist.cjs` 校验（退出码 0）
- harness_report 在首次模拟失败后能自动重试并最终生成报告；3 次均失败时输出 REPORT_FAILED verdict

## 范围限定

**在范围内**:
- Dashboard 新增 Harness 页面（只读）
- `check-manual-cmd-whitelist.cjs` 白名单新增 `playwright`
- `harness-report/SKILL.md` 增加重试逻辑描述

**不在范围内**:
- Harness pipeline 的编排逻辑变更
- Dashboard 其他页面的改动
- Brain API 新增端点（如需要 harness 数据接口，由后续 sprint 处理）

## 预期受影响文件

- `apps/dashboard/src/pages/` (新增目录): 新增 Harness 面板页面组件
- `apps/dashboard/src/pages/reports/ReportsListPage.tsx`: 可能需要参考其数据获取模式
- `scripts/devgate/check-manual-cmd-whitelist.cjs`: ALLOWED_COMMANDS 集合新增 `playwright`
- `packages/workflows/skills/harness-report/SKILL.md`: 增加重试流程描述
- `packages/brain/src/cecelia-routes.js`: 可能需要新增 harness sprint 数据查询 API（待 Proposer 确认）
