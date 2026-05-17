### 根本原因

实现 harness-contract-fix-v1 的 WS2（Pipeline 可视化 API）和 WS3（Report 失败自动重试）。

WS2：新增 `GET /api/brain/harness/pipeline/:planner_task_id` 端点，通过 `id::text = $1 OR payload->>'planner_task_id' = $1` 查询该 planner 下所有 harness/sprint 任务，按 created_at ASC 返回。

WS3：在 execution.js 中新增 `harnessType === 'harness_report'` 分支，当 result=null（session 崩溃）且 retry_count < 3 时自动重试，retry_count >= 3 则打日志后 return 终止。

关键教训：
- PostgreSQL 中 UUID 列与 text 参数比较需用 `id::text = $1`（不能用 `id = $1::uuid`，pg driver 发送 text 类型参数会造成类型不匹配）
- DoD 合同要求 `retry_count >= 3` 检查变量名必须含 `retry_count`（不能用 `retryCount`），因为 CI 静态检查直接 regex 匹配源码

### 下次预防

- [ ] 新增 Express 路由时：先验证 SQL 查询的类型兼容性（UUID vs text 比较方向）
- [ ] DoD Test 命令中有正则匹配变量名时，确保实现代码的变量命名与合同正则一致
- [ ] worktree 测试新 API 端点：需先验证 DB 查询逻辑（direct pg query），再做端到端 curl 测试
