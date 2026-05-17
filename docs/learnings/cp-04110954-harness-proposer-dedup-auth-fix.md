# Learning: harness Proposer 去重 + auth 失败不计 quarantine

**Branch**: cp-04110954-harness-proposer-dedup-auth-fix  
**Task**: 71b1dd76-3cc4-49a8-9b91-ab6ab91481e4  
**Date**: 2026-04-11

### 根本原因

1. **Proposer 重复创建**：harness_planner 完成后，execution-callback 触发 harness_contract_propose 创建。当 Planner 因外部原因（网络抖动、auth 错误）重试后再次触发 callback，会创建第二个 Proposer，导致 GAN 流水线出现并行的竞争性 Proposer，破坏幂等性。

2. **auth/network 错误累计 quarantine**：auth 凭据过期、网络抖动属于外部错误，与任务本身质量无关。但 handleTaskFailure 原先统一累计 failure_count，导致合法的外部错误导致任务被错误隔离，pipeline 被打断。

### 修复方案

1. **Proposer 去重**：在 execution.js Layer 1（harness_planner 完成）创建 Proposer 前，先查询是否已有 `status IN ('queued', 'in_progress')` 且 `planner_task_id` 相同的 Proposer。有则跳过，无则创建。

2. **skipCount 选项**：quarantine.js `handleTaskFailure` 新增 `options.skipCount`。`skipCount=true` 时只执行 `UPDATE tasks SET status='queued'`（requeue），不累计 failure_count，不触发隔离检查。execution.js 在 `isTransientApiError`（rate_limit/network/auth）时传 `{ skipCount: true }`。

### 下次预防

- [ ] 所有 harness pipeline 断链（Layer 1→2→3）都应加幂等去重检查，参考 WS{N+1} 已有的 `already queued` 检查模式
- [ ] 外部错误（auth/network/rate_limit）与系统错误（code bug/logic error）需要区分处理：前者 requeue 不累计，后者正常累计
- [ ] 写 harness pipeline 相关测试时，用字符索引查找关键词时注意窗口大小要充足，或直接用 `toContain` 全文搜索
