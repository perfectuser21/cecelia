## Brain 8张表统一架构（2026-05-25）

### 根本原因
1. `system_registry` 混用 type 字段作多表路由，导致 skill 数据无法独立索引和 Notion 同步
2. `journey_step_links` 连接表缺失，Journey→Step 关系无法在本地 DB 追踪
3. `notion-push-sync` 只同步 journeys/journey_features/issues，skill_registry / journey_steps / journey_step_links 的新数据无法推送 Notion

### 下次预防

- [ ] **mock 污染陷阱**：`vi.clearAllMocks()` 不清 `mockResolvedValueOnce` 队列；若 handler 提前 return 400（不消耗 mock），剩余 mock 会污染后续测试。改用 `type: 'cron'` 等非特殊类型的测试数据，或改用 `vi.resetAllMocks()`
- [ ] **CI 空库测试**：smoke.sh 不能假设 DB 有种子数据（CI 每次 fresh postgres）；count >= N 断言必须改成先 POST seed 再验证，或只验 HTTP 200
- [ ] **migration INSERT...SELECT**：从已有表迁移数据的 migration 在空库 CI 里插入 0 行，smoke 验证应改为「表存在 + 端点可用」而非「数据量 >= N」
- [ ] **branch 落后主干**：rebase 后必须 `git push --force-with-lease`，auto-merge 设置会被 BEHIND 状态阻塞
- [ ] **DeepSeek 误报**：使用参数化查询（`$1, $2`）但 DeepSeek 仍报 SQL injection；`detect-review-issues.js` 遇到这类误报时应有白名单机制
