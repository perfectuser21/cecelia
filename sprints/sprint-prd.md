# Sprint PRD

## 产品目标

验证 PR #2118（`fix: harness_contract_propose verdict=null 导致 GAN 链路沉默中断`）修复后，`execution.js` 中 `fallback→PROPOSED` 逻辑能正确触发 Reviewer，确保 Harness GAN 链路不再因 Proposer 未输出 PROPOSED 关键字而沉默中断。目标用户：Brain 调度引擎本身（自动化质量保障）。

## 功能清单

- [ ] Feature 1: execution.js 静态验证 — 确认 fallback→PROPOSED 代码存在且逻辑正确
- [ ] Feature 2: 单元测试补全 — 覆盖 verdict=null 时 fallback→PROPOSED 分支，验证 Reviewer 任务被创建
- [ ] Feature 3: 完整链路端到端验证 — 模拟 P1（Proposer Round 1）以 verdict=null 完成，确认 R1（Reviewer Round 1）被自动创建

## 验收标准（用户视角）

### Feature 1: 静态代码验证

- 用户能确认 `packages/brain/src/routes/execution.js` 中存在 `fallback→PROPOSED` warn 日志行
- 当 Proposer 完成但未输出任何 PROPOSED 关键字时，代码路径仍会将 `proposeVerdict` 设为 `'PROPOSED'`
- 不存在可能导致 fallback 分支被跳过的条件（如仅在 `status === 'AI Done'` 时才执行）

### Feature 2: 单元测试覆盖

- 存在专门测试 `verdict=null fallback` 场景的测试用例
- 测试能验证：当 callback result 不含 PROPOSED 关键字时，Reviewer 任务创建函数被调用
- 测试能验证：warn 日志被输出，包含 `fallback→PROPOSED` 字样

### Feature 3: 端到端链路验证

- 在 Brain 数据库中模拟一个已完成（status=completed）的 `harness_contract_propose` 任务（result 不含 PROPOSED 关键字）
- 触发 execution-callback 后，Brain 数据库中能查到新创建的 `harness_contract_review` 任务
- 新创建的 Reviewer 任务的 payload 中包含正确的 `propose_task_id`、`propose_round=1`、`planner_branch`

## AI 集成点（如适用）

- 不适用：本次是纯代码验证，不涉及 AI 生成内容

## 不在范围内

- 修改 execution.js 的其他逻辑
- 验证 Reviewer（R1）的执行结果（APPROVED/REVISION）
- 验证完整 GAN 多轮循环（P2→R2 等后续轮次）
- 修改 Proposer 或 Reviewer skill 的内容
