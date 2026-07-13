# Design: 修复 escalation 静默取消/暂停用户任务（Issue 9db1da44）

## 背景

`packages/brain/src/alertness/escalation.js` 的 `emergency_brake`/`graceful_degrade`
响应会批量取消或暂停 `queued`/`pending` 任务，判断依据是 **task_type 黑名单**
（`CANCEL_EXEMPT_TYPES`），不区分任务是系统自产还是用户注册。2026-07-08 深夜，
Brain 内存探测把 372MB 正常水位误判为泄漏信号，触发 emergency_brake →
`cancelPendingTasks` 静默把用户注册的 5 个 P1/P2 任务置为 `canceled`（终态，
API 无法救回），且不写 `error_message`、不写 `status_history`，用户完全无从
得知任务为何消失。同时状态机在 `auto_recovery`/`graceful_degrade` 间反复横跳。

Issue: `9db1da44-dc7b-451e-9f9e-de514f373591`（P0）。
Decision: `d7239f6d-000d-4ce8-8aab-0dcca9292cd0`。

## approach

只有一种合理方案：把"黑名单挡任务类型"改成"白名单放行触发来源"，并把不可逆的
`cancel` 动作换成可逆的 `pause` + 留痕。评估过"保持 cancel 但加白名单"的方案，
被否决——canceled 是终态，即使白名单判断有漏洞也没有恢复余地，pause 更安全。

## 改动点

### 1. `escalation.js`：trigger_source 白名单

新增 `export const SYSTEM_AUTO_TRIGGER_SOURCES`，枚举当前 DB 里已出现的系统自产
来源（`brain_auto`/`auto`/`content_pipeline_orchestrator`/`content_pipeline_api`/
`execution_callback_harness`/`execution_callback_harness_serial`/`self_drive`/
`cortex`/`auto_fix`/`recurring`/`api`/`harness_task_dispatch`/`harness_watcher`/
`harness_deploy_watch`/`brain_cron_smoke_alert`/`brain_cron_daily_smoke`/`rca`/
`active_goals_zero`/`accumulation_trigger`）。`manual*`/`user*`/`owner_input`/
`chat_mouth`/`test` 等一律不在白名单内，天然被排除——不需要单独列黑名单。

`pauseLowPriorityTasks` 与 `cancelPendingTasks` 的 UPDATE 语句都加
`AND trigger_source = ANY($n)`，与既有 task_type 黑名单叠加（防御式双重过滤，
互不冲突）。

### 2. `escalation.js`：cancel_pending 动作改为可逆 pause + 留痕

`cancelPendingTasks` 不再 `SET status = 'canceled'`，改成 `SET status = 'paused'`。
同时 `SET error_message = $1`（值为 `escalation_emergency_brake`）、
`status_history = status_history || jsonb_build_array(jsonb_build_object(
'from', status, 'to', 'paused', 'changed_at', NOW(), 'source', $1))`——
用 UPDATE 语句里 SET 子句引用的 `status` 是更新前的旧值，天然拿到正确的 from。

`pauseLowPriorityTasks` 同样补上 `error_message`（`escalation_graceful_degrade`）
与 `status_history` 留痕，方式相同。

两个函数改名保留（`cancelPendingTasks`/`pauseLowPriorityTasks`），行为改变但对外
接口（`executeAction` 的 `case 'cancel_pending'`）不变，避免影响面扩大。

### 3. `diagnosis.js`：MEMORY_LEAK 加最小采样时间窗

`MEMORY_LEAK.checks` 现在只要 `timeDiffMinutes > 0` 就计算增长率，短间隔
（如几秒内的两次 tick）噪声会被放大成虚高的 MB/分钟速率。加一条
`if (timeDiffMinutes < 2) return false;`，与现有 `history.length < 10` 门槛
一起构成双重保护。

## 不改的部分

- `CANCEL_EXEMPT_TYPES`（task_type 黑名单）保留，作为第二层防御，不删除。
- `checkTransitionRules` 里已有的 1 分钟冷却期（`COOLDOWN_PERIOD`）本次不动——
  横跳问题的主因是白名单/留痕缺失导致后果被放大，不是冷却期本身设计错误；
  冷却期调整需要更多生产观测数据，超出本次 P0 修复范围。

## 测试策略

- Unit（vitest，mock `pool.query`）：
  - `cancelPendingTasks`：断言 UPDATE 语句包含 `trigger_source = ANY`、
    `status = 'paused'`（不含 `'canceled'`），且传入的 trigger_source 参数
    等于 `SYSTEM_AUTO_TRIGGER_SOURCES`。
  - `pauseLowPriorityTasks`：同上，额外断言 `error_message`/`status_history`
    相关 SQL 片段存在。
  - `diagnosis.js` MEMORY_LEAK：构造 `timeDiffMinutes < 2` 但增长率超阈值的
    history，断言 `checks()` 返回 `false`；构造 `timeDiffMinutes >= 2` 且超阈值
    的 history，断言仍能正确返回 `true`（不误伤真实泄漏检测）。
- Regression test 永久留 CI（`packages/brain/src/alertness/__tests__/`）。
- 不做集成/E2E：改动是纯逻辑层（SQL 构造 + 判定阈值），unit test 覆盖到位；
  真实数据库行为已被现有 `escalation.test.js` 的 mock 模式验证过等价可信。

## 风险

- 白名单可能遗漏未来新增的系统 trigger_source，导致新的自动化任务不再被
  escalation 管控（漏管而非误杀，风险方向已从"伤用户"转为"系统降级动作变少"，
  可接受，且比现状安全）。
- **白名单遗漏不止是"未来"风险，当前代码里已有约十几个系统来源
  （`okr_tick`/`execution_callback_auto`/`daily_topic_selection`/`rumination`/
  `curiosity`/`desire_system`/`suggestion_dispatcher`/`learnings_received`/
  `execution_callback`/`watchdog`/`circuit_breaker`/`review_gate_auto`/
  `orphan_detection`/`liveness_probe`/`daily_publish_scheduler`/`architect`
  等）不在 `SYSTEM_AUTO_TRIGGER_SOURCES` 里，escalation 上线当天就管不到它们
  （2026-07-09 最终 code review 发现，Assessment: Ready to merge with fixes）。
- **纠正过度承诺**：本设计文档先前声称"用户/人工注册的任务天然不在白名单内，
  不会被 pause"——这个说法不完全成立。`packages/brain/src/routes/actions.js`
  等 API 创建任务路径若调用方未显式传 `trigger_source`，会落到默认值
  `brain_auto`（在白名单内），该任务仍会被 escalation 的 pause 动作触碰。
  白名单**不是**本次修复防止用户任务受影响的主要机制——真正兜底的是
  Task 3 把 `cancelPendingTasks`/`pauseLowPriorityTasks` 从终态 `canceled`
  改成可逆的 `paused`：即使白名单漏放行了某个实际是用户的任务，它也只会被
  暂停（1 小时内被 `paused-requeuer.js` 自动 requeue 回 `queued`），不会像
  修复前那样永久静默丢失。白名单是第二层防御（减少被误碰的次数），不是
  唯一防线。
- **平行表冲突（已知需收敛，不阻塞本次合并）**：`packages/brain/src/routes/actions.js`
  已有 `systemSources`（`isSystemTask` 用，含 `manual`/`watchdog`/
  `circuit_breaker`/`rumination` 等 9 项）和 `SYSTEM_TRIGGER_SOURCES`（3 项），
  与本次新增的 `SYSTEM_AUTO_TRIGGER_SOURCES`（20 项）对同一个"是不是系统任务"
  问题给出三份不完全一致的答案，存在漂移风险。收敛为单一 SSOT 列为独立
  follow-up（见 Brain Issue，见下）。
- `paused` 任务经 `paused-requeuer.js` 自动 requeue，重试次数计入
  `retry_count`；系统任务反复被误判 escalation（3 次以上）会耗尽重试预算
  进入终态 `archived`。仅影响白名单内的系统任务（用户任务不受此路径影响），
  比修复前的立即 `canceled` 安全得多，但设计时未记录这个交互，此处补充说明。
