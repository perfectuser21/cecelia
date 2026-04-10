# Sprint PRD — Harness contract_branch 传播链修复 + 可视化 + Report 重试

## 背景

Harness v4.0 pipeline 经过多轮修复（PR #2183-#2186），contract_branch 传播链的核心路径（Reviewer→Generator→WS 链→Report）已基本打通。但仍存在三类遗留问题：

1. **contract_branch 传播盲区**：harness_fix → harness_report 路径中，contract_branch 没有透传到 report payload；harness_ci_watch CI 失败 → harness_fix 路径中，contract_branch 也可能丢失（依赖 harnessPayload 透传但 ci_watch payload 未携带 contract_branch）
2. **pipeline 可视化缺失**：当前 pipeline 运行状态只能通过 `curl localhost:5221/api/brain/tasks` 手动查询，无法直观看到 Planner→GAN→Generator→CI→Report 的链路和每个节点状态
3. **Report 重试缺失**：harness_report 完成回调在 execution.js 中没有任何处理分支 — 如果 report session 崩溃（result=null），pipeline 就静默结束，不会重试

## 目标

确保 Harness pipeline 全链路可靠（contract_branch 零丢失）、可观测（一眼看到 pipeline 状态）、可自愈（report 失败自动重试）。

## 功能列表

### Feature 1: contract_branch 全链路透传
**用户行为**: 用户触发一个包含多 Workstream 的 Harness pipeline
**系统响应**: contract_branch 从 Reviewer APPROVED 开始，在后续所有环节（Generator、CI Watch、Fix、Report）的 payload 中完整传递，任何环节都可以通过 `payload.contract_branch` 获取合同分支
**不包含**: 不改变 contract_branch 的生成逻辑（Reviewer 负责），不改变 GAN 对抗流程

### Feature 2: Pipeline 状态可视化 API
**用户行为**: 用户调用 `GET /api/brain/harness/pipeline/{planner_task_id}` 查看某次 pipeline 运行
**系统响应**: 返回结构化 JSON，包含 pipeline 各阶段任务的 task_id、task_type、status、verdict、耗时、pr_url 等信息，按链路顺序排列，可直观看到整条链路状态
**不包含**: 不做前端 UI 渲染（仅 API），不做实时 WebSocket 推送

### Feature 3: Report 失败自动重试
**用户行为**: harness_report session 崩溃（result=null）或输出解析失败
**系统响应**: execution.js 在 harness_report 回调中检测异常，自动创建重试任务（最多 3 次），确保每次 pipeline 运行最终产出报告
**不包含**: 不重试 report 内容质量问题（只处理 session 崩溃/无输出），不改变 report 内容格式

## 成功标准

- contract_branch 在以下 5 条路径中均完整透传：
  1. Reviewer APPROVED → Generator（已有 ✅）
  2. Generator → 下一个 WS Generator（已有 ✅）
  3. Generator → CI Watch payload
  4. CI Watch CI 失败 → harness_fix payload
  5. harness_fix → harness_report payload
- Pipeline 可视化 API 返回完整链路，包含每个节点的 task_type / status / verdict / 耗时
- harness_report result=null 时自动重试，最多 3 次，重试次数可在 API 返回中观测到

## 范围限定

**在范围内**:
- execution.js 中 harness 回调链路的 contract_branch 补全
- harness-watcher.js 中 CI Watch payload 的 contract_branch 补全
- 新增 pipeline 可视化 API 端点
- execution.js 中 harness_report 回调分支（当前不存在，需新增）

**不在范围内**:
- GAN 对抗逻辑变更
- Planner/Proposer/Reviewer skill 内容变更
- 前端 Dashboard 可视化（仅后端 API）
- v3.x sprint_* 类型兼容修复

## 预期受影响文件

- `packages/brain/src/routes/execution.js`：harness 回调链路，补全 contract_branch 透传 + 新增 harness_report 重试逻辑
- `packages/brain/src/harness-watcher.js`：CI Watch 和 Deploy Watch 的 payload 构建，需携带 contract_branch
- `packages/brain/src/routes/execution.js` 或 `packages/brain/src/server.js`：新增 `/api/brain/harness/pipeline/:planner_task_id` API 路由
- `packages/brain/src/__tests__/harness-pipeline.test.ts`：补充 contract_branch 全链路透传测试 + report 重试测试
