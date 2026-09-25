# owner_decision 批准处理器 + 到期默认执行（决策 105a5868 三档协议最后一环）

任务 8aa79219 · 链 bf5088a3 棒 9 · 分支 cp-0925194739-approval-handler

## 病根

棒 5 让 `blocked_reason='owner_decision'` 的任务必带协议，`waiting_on=human` 还会生成 `pending_actions` 待办。但应答通路缺两块：

1. `decision-executor.actionHandlers` 没有 `owner_decision`，主理人点批准得到 `No handler`。
2. 协议承诺的"到期不答按默认走"没有任何代码执行。
3. 附带两个会让承诺落空的既有行为：`unblockExpiredTasks` 会在 `blocked_until` 到期时把 owner_decision 任务无决议地放回 queued；`expireStaleProposals` 会在 `expires_at`（= deadline）到期把待办标 expired，之后主理人再也批不了。

## 设计

### 单一内部函数 `applyOwnerDecisionResolution(db, {...})`（`lib/owner-decision-resolve.js`）

批准与到期默认走同一个函数，调用方管事务。步骤（同一事务）：

1. `SELECT ... FROM tasks WHERE id FOR UPDATE`，要求 `status='blocked' AND blocked_reason='owner_decision'`，否则 409。
2. `waiting_on<>'human'` → 400（machine 型不该有待办）。
3. 解析 choice：缺省或 `default` 取协议 `default`；否则按选项全文或前缀标签（`A`/`A:`/`A 摘`）大小写不敏感匹配；未知 → 400，不改任何状态。
4. 写 `payload.owner_decision`（协议快照 + `resolution={choice, chosen_option, by, at, via}`）。blocked_detail 会被 unblock 清空，所以快照必须留在 payload。
5. 关待办（`approved`，`reviewed_by=by`），再 `unblockTask(taskId, {db})` 回 queued（走状态机收口，不直写 tasks 状态）。
6. 写 `decisions`：category `decision`（`execution` 不在 `decisions_category_chk` 白名单，直写会 23514），`made_by` 批准=user / 到期默认=system。

### 批准 / 驳回

- `POST /pending-actions/:id/approve {reviewer, choice}` → `approvePendingAction(id, reviewer, {choice})` → `actionHandlers.owner_decision`（在原有事务里调核心函数）。二次 approve：待办已非 pending_approval → 409。
- 驳回：`rejectPendingAction` 对 owner_decision 在同一事务里写 `resolution={choice:null, via:'reject'}`，任务保持 blocked，待办置 rejected。被驳回的任务被 sweeper 跳过（主理人明确表态过，不能被默认覆盖）。
- owner_decision 待办不再被时间过期：`expireStaleProposals` 排除它；`approvePendingAction` 对它跳过 expires_at 检查。截止由 sweeper 负责。

### 到期默认 sweeper `owner-decision-deadline`（`owner-decision-deadline.js`）

- JOBS 新增一项，进程内 10 分钟自 gate；`livenessIntervalSec: 60`（调度轮 60s 都会调它，间隔尺子按调度轮算，与 gp-shelf-life 同）。
- 候选：`status='blocked' AND blocked_reason='owner_decision' AND waiting_on='human'`，到期时刻 `due = GREATEST(deadline, blocked_until)`（blocked_until 为空则取 deadline）。取较晚者，避免在主理人声明的截止前提前执行默认；顺延 24h 后 blocked_until 抬高，同一任务不会每轮重复处理。
- 有界：每条 SQL `query_timeout`；每任务独立事务，`SET LOCAL statement_timeout/lock_timeout`；取连接带超时；整轮时间预算，超出即停（下一轮续）；单任务失败不影响其余。
- `reversible=true` 且有 default → 调核心函数（`via:'default_on_deadline'`，`by:'system'`），写 decisions（made_by=system），Bark P2 `dedupeKey=owner_decision_default_<task_id>`。
- `reversible=false` → 不执行；`blocked_until` 顺延 24h，`payload.owner_decision.deadline_deferrals` 计数留痕，同步抬高待办 expires_at，Bark P1 再催一次。
- `unblockExpiredTasks` 排除 `owner_decision + waiting_on=human`（machine 型仍到期自动放行，那是等机器重试）。

## 测试策略

集成（真 PG，临时库，照 task-governance-guards.pg.integration.test.js）覆盖九个分支：approve 选 A / 选 default / 未知 choice / 二次 approve / reject / machine 被拒 / sweeper 可逆走默认 / sweeper 不可逆顺延 / sweeper 幂等；外加 blocked_until 早于 deadline 不提前执行、驳回后 sweeper 跳过、待办不被时间过期。单元覆盖选项解析纯函数、JOBS 登记、unblockExpiredTasks 过滤 SQL。
