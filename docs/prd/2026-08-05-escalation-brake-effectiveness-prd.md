# PRD：让熔断真的刹得住车 —— Escalation 三动作有效性与恢复闭环

- 日期：2026-08-05
- 状态：待执行（前一 session 已完成事实核查与根因确认，本 PRD 自包含，无需重新考古）
- 锚点：`none(infra)`（Brain 自身可靠性基建，不推进业务 Golden Path）
- 前置已交付：PR #4624（cancel_pending / pause_low_priority 的 SQL `$3` 类型修复，已合并并在生产验证生效）

---

## 一、背景：一次熔断暴露出三层问题

2026-08-05 凌晨，Brain 检测到本机持续高负载（CPU 83%、load 8.8/10核），升级到 L2 紧急制动，执行三个动作。实际结果：

| 动作 | 日志说 | 真实发生了什么 |
|---|---|---|
| `stop_dispatch` | `Task dispatch stopped` | ❌ **什么也没发生**（见下方证据链） |
| `cancel_pending` | `Action failed: could not determine data type of parameter $3` | ❌ 崩溃 → 已由 PR #4624 修复，现已生效 |
| `enable_safe_mode` | `Safe mode enabled` | ❌ **什么也没发生** |

也就是说：**熔断触发了，但车没刹住**，而日志还打印了"已停止派发/安全模式已开启"——比不刹车更糟的是让人以为刹住了。前一 session 就被这行日志误导，一度判断"派发被安全模式锁着，需要先降负载"，实为误判，特此纠正。

---

## 二、三个缺陷（均已实证，不是推断）

### 缺陷 1：`stop_dispatch` 与 `enable_safe_mode` 是空动作

**证据链**：
1. 两个动作的实现只做两件事——`emit('escalation:stop_dispatch')` / `emit('escalation:safe_mode', {enabled:true})` 加一行 `console.log`（`packages/brain/src/alertness/escalation.js:404, 458`）
2. 全仓库搜 `stop_dispatch` / `safe_mode`，除 escalation.js 自身外**零消费者**
3. 根因：`packages/brain/src/event-bus.js` 只导出 `ensureEventsTable, emit, queryEvents, getEventCounts` — **没有 `on`/`subscribe`**。它是"往 events 表写一行"的记录器，不是发布订阅总线。emit 出去的事件在运行时不会触达任何代码。
4. 反证：日志里真实出现过的 `[tick] dispatch 停止: pool_c_full` 来自 `packages/brain/src/dispatcher.js:329`，判据是 slot budget 不足，与 escalation 无关——**派发变慢是背压所致，不是熔断所致**。

### 缺陷 2：没有任何复位路径

- `escalationState.isActive` 只被置 `true`，全仓库搜不到置回 `false` 的地方；无 `resetEscalation` / `deescalate` 类函数
- 后果：一旦升级，状态永远停在最高级；`determineResponseLevel` 靠 `targetLevel !== currentLevel` 判断是否执行，意味着**同级不会重复执行、降级也不会触发任何"松开刹车"的动作**

### 缺陷 3：被熔断暂停的任务无人恢复

- PR #4624 生效后 cancel_pending 终于能干活了，实测暂停 **12 个**（`error_message='escalation_emergency_brake'`）；pause_low_priority 暂停 **8 个**（`escalation_graceful_degrade`）
- 但没有任何机制把它们放回队列。系统缓过来之后，这批任务永久卡在 `paused`
- 波及范围（08-04 实测）：harness_initiative ×3、dev ×1、strategist_decision ×5、skill_eval ×7、ci_patrol ×2、staging_e2e ×1、trigger_backup ×1
- 另有 **82 个 5~7 月的历史 paused 任务**（`error_message` 为空，来源不明），本 PRD **不处理**，仅登记

---

## 三、目标（用户语言）

1. 熔断触发时，派发**真的**停下来；解除时**真的**恢复——不再是只打日志
2. 系统缓过来后，被熔断暂停的任务**自动回到队列**，不需要人工捞
3. 日志说的话和系统实际做的事一致——不再出现"说停了其实没停"

---

## 四、范围

### 做

1. **让两个空动作真正生效**
   - 引入一个进程内的运行时开关（如 `packages/brain/src/alertness/brake-state.js`：`isDispatchHalted()` / `haltDispatch()` / `resumeDispatch()`），由 escalation 写、dispatcher 读
   - `dispatcher.js` 派发前检查该开关；被熔断拦下时日志要与 slot budget 拦截**区分开**（避免又一次归因混淆）
   - 选型注记：**不要**为此把 event-bus 改造成发布订阅系统——那是更大的改动面且非必需；进程内共享状态模块即可（Brain 是单进程）。若未来确需跨进程，另立项。

2. **补复位路径**
   - alertness 等级回落到 CALM/AWARE 且持续 N 分钟（建议 5 分钟，可配置）→ 执行"松开刹车"：`resumeDispatch()` + `escalationState` 复位 + 记录复位事件
   - 复位必须写日志与 events 表，可被审计

3. **补任务恢复**
   - 复位时把 `status='paused' AND error_message IN ('escalation_emergency_brake','escalation_graceful_degrade')` 的任务批量放回 `queued`，并在 `status_history` 留痕（`from=paused, to=queued, source=escalation_recovery`）
   - **只碰这两种 error_message**，绝不碰 82 个历史 paused 任务（它们来源不明，误放回可能造成意外执行）

### 不做

- 历史 82 个 paused 任务的甄别与处置（另立项；先在 issues 登记）
- 本机高负载本身的治理（OrbStack 占 133% CPU 等，属运维话题）
- event-bus 改造为真正的发布订阅系统
- 四类定时任务消费者全死的问题（arch_review 从无成功记录、staging_e2e 末次成功 07-23、strategist_decision/ci_patrol 停在 07-30）——**独立且更值钱的一刀，强烈建议紧接着立项**

---

## 五、验收标准

> 守卫必须 proven-to-fire：每条都要亲眼看它报红过一次才算数。本仓教训：既有 escalation 单测 mock 了 `pool.query`，SQL 从未被真正解析，这正是 `$3` bug 逃逸的原因（同源事故：`autoblock-sql-integration.test.js`，上次是 `$2`）。

1. **停派发真生效**：模拟触发 L2 → dispatcher 的派发入口被拦截（断言拦截原因是熔断，不是 slot budget）；变异测试：把拦截判断删掉 → 守卫必须红
2. **复位真生效**：alertness 回落并持续到阈值 → 派发恢复、`escalationState.isActive === false`；变异：删掉复位调用 → 守卫必须红
3. **任务恢复真生效**：造 3 条 `escalation_emergency_brake` 的 paused 任务 + 1 条历史 paused（error_message 为空）→ 复位后前 3 条回到 `queued` 且 status_history 有留痕，**第 4 条必须纹丝不动**
4. **日志诚实**：熔断动作若未真正生效，禁止打印"已停止/已开启"字样（可加断言扫描日志文案）
5. 既有 escalation 测试不回归（当前 30/30 绿）
6. CI 全绿

---

## 六、给执行者的现成上下文（省去重新考古）

**代码位**
- `packages/brain/src/alertness/escalation.js`：三动作定义在 `RESPONSE_ACTIONS.emergency_brake`（L46-54）；`executeAction` switch 在 L262+；`stopDispatch()` L402；`enableSafeMode()` L456；`cancelPendingTasks()` / `pauseLowPriorityTasks()` 已抽出 `buildCancelPendingQuery` / `buildPauseLowPriorityQuery` 两个纯函数（PR #4624）
- `packages/brain/src/dispatcher.js:329`：现有的 slot budget 拦截点，新的熔断拦截应与之并列且日志可区分
- `packages/brain/src/event-bus.js`：只有 emit，无订阅（缺陷 1 的根因）

**测试怎么写才有效（PR #4624 血泪）**
- 需真库的测试**必须**放 `packages/brain/src/__tests__/integration/` 且命名 `*.integration.test.js` —— 放根目录会被 `brain-unit` 分片扫到（该分片无 postgres，报 `AggregateError from pg-pool` 而非 SQL 错，极具误导性）
- 参考现成范例：`packages/brain/src/__tests__/integration/escalation-cancel-pending-sql.integration.test.js`

**CI 规矩**
- 改 `packages/brain/src/**` 必须 `cd packages/brain && npm version patch --no-git-tag-version`
- 且必须同步 `DEFINITION.md` 的 `**Brain 版本**` 行，否则 `gp-governance-decisions-smoke` 的 Facts 核对项报红
- 预览环境部署 job 在本机高负载时会健康检查超时，属环境噪音，重跑即可

**验证生产是否真的生效**
```bash
docker exec cecelia-node-brain sh -c "grep '\"version\"' /app/package.json | head -1"   # 看容器版本
psql "postgresql://cecelia:cecelia@localhost:5432/cecelia" -At -c \
  "SELECT error_message, count(*) FROM tasks WHERE status='paused' GROUP BY 1"          # 看暂停来源
docker logs cecelia-node-brain --since 10m 2>&1 | grep -i Escalation                    # 看熔断动作
```
