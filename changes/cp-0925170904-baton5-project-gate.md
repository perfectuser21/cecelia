## Brain {VERSION} — 决策分档机械守卫 + 依赖单一写口（链 bf5088a3 棒5·PR A，任务 3fad28e0，决策 105a5868）

- 守卫 1（goal_id 必须是 KR 级）：`POST /tasks` 与 `createRoutedTask` 给了 `goal_id` 就必须存在于 `key_results.id`，给 Objective id 返 400 `goal_id_not_key_result` 并列出其名下 KR（原先挂 Objective 的任务被 tick 派发白名单静默过滤、永远 queued 无日志）；不给 goal_id 行为不变；KR 状态不在派发白名单只提示 warning
- 守卫 2（owner_decision 协议）：`blocked_reason=owner_decision` 必带 `blocked_detail{question,options[2+],default,deadline,reversible,waiting_on:human|machine}`，缺项 400 并列全缺项；入口四道——`blockTask`（`/tasks/:id/block` 原先一律 404，现协议违规回 400）、`POST /tasks` 建单（新增 `blocked_reason/blocked_detail` 入参）、`createRoutedTask`、迁移 469 触发器（psql 直写也拦，只拦新写入，存量 blocked 行不回填不报错）；`waiting_on=human` 生成 pending_action（signature 去重、expires_at=deadline），`machine` 不进主理人待办；`unblockTask` 关闭对应待办
- 依赖单一写口 `lib/task-dependencies.js`：`task_dependencies` 边与 `payload.depends_on` 同步写（自环/不存在/成环拒绝）；建单带 `depends_on` 同事务写 hard 边；`harness-dag`、`proposal.js` 改走写口；新增 `GET/POST/DELETE /api/brain/tasks/:id/dependencies`；`task-dependencies-single-writer` 守卫（含变异）扫 src 内任何绕过写口的直写
- 迁移 469 + 回滚脚本；smoke `task-governance-guards-smoke.sh` 登记 allowlist；PG 集成测试建库跑全量 migrate 验证触发器 proven-to-fire
