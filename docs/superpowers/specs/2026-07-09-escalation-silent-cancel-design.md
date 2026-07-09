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
