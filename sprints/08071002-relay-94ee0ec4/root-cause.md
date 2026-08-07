# Root Cause — never_started 假杀失败模式（task 94ee0ec4 / 事故任务 b35bfa0c）

事故：任务 b35bfa0c-c798-45a5-80dc-16f12e35ca6d（task_type=dev，P0，payload.headed_manual=true）
从未被真实 spawn（零留痕：无 activeProcesses 条目、无 /tmp/cecelia-<id>.log、无 error_message、
task_events / dispatch_events 0 行），却被 liveness watchdog 双确认后按 never_started 杀死
（watchdog_kill ts=2026-08-07T02:01:08.883Z，suspect since 01:56:08.832Z）。

以下对根因链 a/b/c 三候选逐一证实/证伪，全部为一手证据（代码位置 / DB 查询 / docker inspect）。

---

## a) 探测谓词过宽 / 错标运行中 —— **部分证实（kill 授权谓词过宽），部分证伪（探测集合谓词无误）**

**证伪面（探测集合选择）**：liveness 探测集合的 SQL 基底谓词是
`SELECT ... FROM tasks WHERE status = 'in_progress'`（`packages/brain/src/executor.js`
probeTaskLiveness 开头），不含 queued——queued 任务本身不会被探测。探测集合谓词没有过宽。

**证实面（kill 授权谓词）**：任务确实曾被翻成 in_progress（watchdog_kill 由 requeueTask 的
`WHERE status = 'in_progress'` 主路径写入，可反推 kill 时刻状态），而修复前代码在「双确认
DEAD」之后**无条件进入 kill 分类处置**：`checkExitReason` → `isNeverStarted` 收窄的只是
「分类标签」（process_disappeared → never_started，executor.js 1dfa40f7 注释块），**不收窄
「是否允许杀」**——零 spawn 证据（无 activeProcesses 条目、无进程日志、无派发回执）的任务
照样走 `requeueTask(task.id, 'liveness_dead', ...)` 被写 watchdog_kill + failure learning。
即：kill 授权缺「spawn 证据」前置校验，这是假杀的直接机制。

**结论**：证实（以 kill 授权谓词过宽的形态）。修复：双确认 DEAD 后先验 spawn 证据
（activeProcesses 条目 / 进程日志 / error_message 派发回执，判定点登记表组合判定），零证据
→ 带 task_events 留痕的安全回队，不进 kill 分类。

## b) claim 后 spawn 静默失败缺 fail-closed 回执 —— **证实**

一手证据：

1. **事故任务 payload 无 spawn 必经点写入**：`triggerCeceliaRun` 在 spawn 前必经
   `updateTaskRunInfo(task.id, runId, 'triggered')`（executor.js），会写
   payload.current_run_id / run_status / run_triggered_at。DB 实查：
   `SELECT payload->>'current_run_id', payload->>'run_triggered_at' FROM tasks WHERE id='b35bfa0c-...'`
   → 两者均为空。**任务从未走到 spawn 序列**，但状态是 in_progress——翻状态
   （dispatcher.js「4. Update task status to in_progress」）与 spawn 之间的链路中断了。
2. **dispatch_events 回执与任务无法关联**：修复前 dispatcher.js 全部 22 个
   `recordDispatchResult(...)` 调用点**无一传第 5 参 taskId**（grep 实证），故
   dispatch_events.task_id 恒 NULL——DB 实查事故窗口（2026-08-07T01:40Z–02:05Z）
   dispatch_events 仅 1 行（02:03:05 dispatched，task_id=NULL，为 kill 后其他任务），
   01:51–01:56（任务被翻 in_progress 的窗口）**0 行**。即使 dispatcher 写了失败回执，
   也永远查不到是谁的——fail-closed 回执链断裂。
3. **进程中断窗口真实存在**：`docker inspect cecelia-node-brain --format '{{.State.StartedAt}}'`
   → 2026-08-07T00:51:01Z，Brain 容器在事故前 1 小时刚重启过。mark in_progress 之后、
   spawn / 回执写入之前进程中断（重启/崩溃），任务即滞留 in_progress 且零留痕——
   现有 postClaimException / revert-to-queued 兜底都无法覆盖进程级中断。
4. **容器日志佐证**：自任务创建（08-06T12:53Z）起 grep 完整 task id 仅 3 行
   （liveness SUSPECT / confirmed DEAD / auto-learning requeued），无任何 dispatch/spawn
   记录（controller 一手核实）。注：dispatcher 部分日志只打 task id 前 8 位或不打 id，
   该 grep 有假阴性面，但与证据 1/2 交叉后结论不变——**无任何可关联该任务的派发回执**。

**结论**：证实。claim→mark in_progress→spawn 链存在零留痕中断窗口，且失败回执
（dispatch_events）不带 task_id，无法事后归因。修复：(i) claim 后失败路径的
recordDispatchResult 全部补传 taskId；(ii) triggerCeceliaRun spawn 失败路径落
task_events(failed_dispatch) 行；(iii) 即便留痕仍缺（进程中断窗口无法从根上消除），
零 spawn 证据任务由 a) 的 kill 授权校验兜底——不 kill、安全回队。

## c) headed_manual 语义悬空 —— **证实**

一手证据：`grep -rn "headed_manual" packages/ scripts/ apps/ --include=*.js --include=*.mjs
--include=*.sh`（修复前）→ **0 命中**。建单方在 payload 写入 headed_manual=true
（b35bfa0c 实证生产 payload 存在该旗标），期待「留给有头人工执行、勿无头派发」，但整个
monorepo 没有任何代码消费该旗标——任务被 selectNextDispatchableTask 当普通 dev 任务选中、
claim、翻 in_progress，进入无头链路后因 b) 的中断窗口滞留，再被 a) 的 kill 授权缺口假杀。
headed_manual 悬空是事故的**诱因**（任务本不该进无头派发）。

**结论**：证实。修复（消费方向，decisions 拍板留痕 id=433fb902-869f-4d49-aeab-a08e2e4bc897）：
(i) selectNextDispatchableTask 派发谓词排除 `payload->>'headed_manual' = 'true'`（jsonb 布尔
与字符串 true 均识别）；(ii) liveness 零证据安全处置对 headed_manual 任务打
watchdog_headed_requeue 事件标记，回 queued 保持等待有头执行。

---

## 根因链定性

```
c) headed_manual 悬空（诱因：headed 任务进了无头派发）
   → b) claim→spawn 链中断且零留痕（机制：任务滞留 in_progress、无任何回执）
   → a) kill 授权缺 spawn 证据校验（终点：零证据任务被判 never_started 假杀）
```

三层各自独立修复，任一层修复都能阻断本事故形态；三层全修 + 回归测试永久入 CI
（liveness-queued-never-spawned.integration.test.js，4 it）构成纵深防御。

---

## b35bfa0c 处置

**不变更原任务数据**（合同 FR-5「若变更须留痕」条件不触发）：

- 当前状态（DB 实查）：status=blocked（blocked_at=2026-08-07T02:21:13Z，
  blocked_reason=pre_flight_rejected——kill 后 requeue 重试链于 next_run_at=02:16 重派时被
  pre-flight 拒绝而 block，属既有重试链行为，非本 sprint 改动）。
- payload.watchdog_kill（reason=never_started）与 watchdog_retry_count=1 **保留不清洗**，
  作为事故一手证据留档。
- 修复合入后，b35bfa0c 的 headed_manual=true 使其解 block 回 queued 后不再被无头派发，
  按拍板语义等待有头人工执行；D1 工程本体由该任务自己的链路承担，本 sprint 不抢做（防双跑）。
- 因未变更任何数据，无需新增留痕行；如后续人工解 block，属新操作由操作方留痕。
