# Learning: cp-0527160626-harness-pipeline-5bug-fix

### 根本原因

5 个独立 bug 共同暴露了 harness pipeline 的脆弱边界：

1. **B1 liveness 误判**：`_waitForSubGraphCompletion` 在容器死亡时直接 invoke failure，未先验证 PR 是否已 merged（PR merged 后容器退出是正常路径）。
2. **B2 僵尸容器**：zombie-reaper 豁免 harness_* 类型（设计合理，防误杀），但 initiative 终态没有主动 cleanup，形成永久 zombie。
3. **B3 initiative_id "pending"**：Planner prompt 未明确要求使用 `$HARNESS_INITIATIVE_ID` 环境变量，Planner 倾向写 "pending" 作占位符。
4. **B4 varchar 溢出**：`daily_logs.type` VARCHAR(20) + CHECK 约束过时，'nightly_orchestration'（21 字符）两个条件都不满足。
5. **B5 LangSmith 429**：`.env` 开启了 tracing，月度 quota 耗尽后每次 tick 都报 429，影响可观测性系统。

### 下次预防

- [ ] Liveness 路径变更时，始终检查是否需要考虑"已完成但 callback 未到"的 race condition
- [ ] 任何 initiative 状态机终态转换，都应触发资源清理（容器、worktree、lock file）
- [ ] Prompt 中注入的环境变量必须明确说明"使用 $VAR_NAME，禁止写占位符"
- [ ] DB 字段新增 enum 值时，需同时检查 VARCHAR 长度 + CHECK 约束两处
- [ ] LangSmith/observability quota 需要监控告警，不应靠日志里的 429 发现
