### 根本原因

`getGuidance('strategy:global')` 读取的 `brain_guidance` 表中，意识循环的 decision 通过 `setGuidance` 写入时设了 24h TTL。但 consciousness-loop 若被静默或长时间未运行，旧 decision（含 `decision_id`）可在调度层持续存活 24h，导致"retry bb776b90"类过期 action 误导 dispatcher。

本质上，`brain_guidance` 的 `expires_at` 是绝对过期时间，而 decision 的"活跃度"需要相对于 `updated_at` 的滑动窗口检查。

### 解决方案

在 `getGuidance()` 层面为含 `decision_id` 字段的 guidance 增加短路 TTL（默认 15 分钟）：
- `SELECT` 语句加入 `updated_at` 字段
- 若 value 含 `decision_id`，检查 `updated_at` 距今是否超过 `DECISION_TTL_MIN` 阈值
- 超过则返回 `null`，让 tick-scheduler 走 `EXECUTOR_ROUTING` fallback

### 下次预防

- [ ] 给 `brain_guidance` 写入方（`setGuidance`）加 decision 专用 TTL 常量提示，让调用方明确 decision 应使用短 TTL
- [ ] 考虑在 consciousness-loop 启动时清除 stale strategy:global guidance（而非依赖 TTL 自然过期）
- [ ] 监控 `[guidance] strategy decision stale` 日志频率，若频繁出现说明 consciousness-loop 本身需要修复频率
