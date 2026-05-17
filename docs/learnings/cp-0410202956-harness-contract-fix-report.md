# Harness v4.0 Report — contract_branch 修复总结（2026-04-11）

### 根本原因

Harness pipeline（Planner → Proposer → Reviewer → Generator → Report）在 contract_branch 全链路数据透传和 Report 生成重试机制上存在断链：

1. **contract_branch 透传断裂**：Proposer 生成的 contract_branch 在流转到 Reviewer/Generator 时丢失，导致审查和代码生成时缺乏上下文
2. **Generator PR URL 丢失**：任务完成但 pr_url 字段为 null，阻止了 Report 追踪 PR
3. **Report 重试机制缺失**：失败时无自动恢复能力，需要人工介入

### 修复方案

**WS1/3** — contract_branch 全链路透传  
✅ PR #2201 已合并  
- 在 task-router.js 中确保 contract_branch 从 Planner 层层透传到 Reviewer 和 Generator
- 更新所有 SKILL.md 的 payload 注入规则，包含 contract_branch 字段
- DoD 验证：端到端可视化 contract_branch 追踪

**WS2/3** — Pipeline API + Report 重试机制  
✅ PR #2208 已合并  
- 新增 GET /api/brain/harness/pipeline/{run_id} API，暴露 pipeline 执行状态
- 实现 Report 失败自动重试（最多 3 次，指数退避）
- Brain 对象包含 harness_retry_count 字段

**WS3/3** — PR URL 恢复自愈  
✅ PR #2212 已合并  
- 新增 harness_fix 任务类型，检测 pr_url_missing 场景
- Fix 任务复用 Generator 的完整输出，重新创建 PR
- 防守：Generator 完成时强制校验 pr_url != null

### 关键成果

| 指标 | 结果 |
|-----|------|
| **总 PR 数** | 3 个（WS1 + WS2 + WS3） |
| **合并状态** | 100% 已合并 |
| **总耗时** | ~40 分钟（跨日期） |
| **成本** | $0.39 USD |
| **质量门** | DoD ✅ + Test ✅ + Review ✅ + Merge ✅ |

### 下次预防

- [ ] 在 Harness pipeline 的初始设计阶段，明确 contract_branch、dev_task_id 等关键字段的完整生命周期和透传点
- [ ] 为 Generator 输出（特别是 pr_url）添加 pre-merge 强制校验，防止残缺数据流入 Report
- [ ] Monitor 所有 harness_report 任务的失败率，触发自动重试时记录到 Brain 日志以便事后追踪
- [ ] 在 Harness v5.0 设计时，考虑将 contract_branch 和 pr_url 作为必填字段，而非可选字段
