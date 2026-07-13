# scheduler-jobs 声明式定时任务注册表 — 设计 spec

日期：2026-07-06 · 分支：cp-0706154841-scheduler-jobs-registry · Brain task：fb00e0b8
背景：作战循环 P1-PR1（设计总纲 docs/current/battle-loop-design.md，本 PR 一并入库）

## 问题

Wave 2 重构（2026-05-04）后 `tick-loop.js` 不再调用 `tick-runner.js#executeTick`，其 step 10.x 约 25 个定时总结/巡检/触发调用全部成为死代码：管家日报停更、arch_review 停摆、strategy_session 从未触发、capture 消化断线。需要一条声明式恢复通道，首批救活 4 个。

## 候选方案

- **A（选定）：统一 60s 轮询 + 模块自 gate**。注册表每 60s 顺序调用全部 job，该不该真正执行由各模块内置逻辑决定（triggerArchReview 自带 4h 窗口+recent 去重+dev-completed guard；maybeTriggerStrategySession 自带 active_goals=0 gate+24h 冷却）。注册表只负责：错误隔离、timeout、观测哨兵。
- B：注册表实现 cron 表达式调度。否决——与模块内置 gate 双重判定打架，引入两处时区语义（判定点机制首次落地，见 PrepPRD 判定点登记）。
- C：延续现状逐个 setInterval 挂 server.js。否决——无统一错误隔离/timeout/观测，正是要治的病（server.js 已有 14+ 个裸 setInterval）。

## 设计

### 新文件 `packages/brain/src/scheduler-jobs.js`

```js
export const JOBS = [
  { name: 'arch-review',         needsPool: true,  timeoutMs: 5*60*1000, handler: triggerArchReview,           description: '架构巡检（自带4h窗口+guard）' },
  { name: 'strategy-trigger',    needsPool: true,  timeoutMs: 5*60*1000, handler: maybeTriggerStrategySession, description: '战略会应急触发（自带active_goals gate+24h冷却）' },
  { name: 'conversation-digest', needsPool: false, timeoutMs: 5*60*1000, handler: runConversationDigest,       description: '对话提炼' },
  { name: 'capture-digestion',   needsPool: false, timeoutMs: 5*60*1000, handler: runCaptureDigestion,        description: 'capture 消化（想法箱进箱通道）' },
];
export async function runSchedulerJobsOnce(pool)   // 供测试与单发
export function startSchedulerJobsLoop(pool)       // setInterval 60s
```

- 顶部静态 import 四个 handler 模块（server.js 挂载点用动态 import 包 try/catch：挂载失败只损失整个注册表且非阻断，模块级问题在挂载时即暴露）。
- `runSchedulerJobsOnce`：顺序遍历 JOBS（4 个 job 均轻量，串行避免 DB 争用）。每个 job：
  - `Promise.race([handler(...), timeout(timeoutMs)])`——超时**不 reject**，返回 `{timedOut:true}` 标记并 `console.warn`（JS 无法强杀 promise，标记即可；参考 tick-runner withThalamusTimeout 范式）
  - 单 job 异常 → `console.warn('[scheduler-jobs] <name> failed:', e.message)`，**继续下一个 job**
  - 执行后写观测哨兵：`INSERT INTO working_memory (key, value_json, updated_at) VALUES ('scheduler_job_last_run:<name>', {at, ok, detail}, NOW()) ON CONFLICT (key) DO UPDATE ...`（模式抄 conversation-consolidator.js:169）。**哨兵只作观测**（供死人开关/战报查"最近一跑"），幂等由模块自 gate 负责——Brain merge 重建常态下，重启后 60s 内恢复调用，模块 gate 是 DB 级判断，重启安全无跳发/双发。
  - 哨兵写入失败自身也被 try/catch（观测不能杀业务）。

### `packages/brain/server.js` 挂载

对齐 server.js:791-800（Notion Push Sync）try/catch 非阻断先例：

```js
try {
  const { startSchedulerJobsLoop } = await import('./src/scheduler-jobs.js');
  startSchedulerJobsLoop(pool);
  console.log('[Server] scheduler-jobs started (60s loop, 4 jobs)');
} catch (e) { console.warn('[Server] scheduler-jobs init failed (non-fatal):', e.message); }
```

### `packages/brain/src/tick-runner.js`

4 处对应调用点（:1042 strategy、:1544 arch review、:1557 conversation digest、:1561 capture digestion）上方加注释：
`// DEPRECATED(P1-PR1 2026-07-06): 已迁移 scheduler-jobs.js。executeTick 整体自 Wave 2 起不被调用；若未来复活本函数，必须先移除此调用以防双跑。`
不删代码。

### 文档

- `docs/current/battle-loop-design.md`：作战循环设计总纲 markdown 版（8 拍板 + 四期 + 前置清单）。
- `docs/current/executetick-dead-jobs-inventory.md`：executeTick step 10.x（tick-runner.js:1534-1710 及 :1042）全部死调用逐条清单，三列状态：已迁移（本 PR 4 个）/待迁移（标注归属 P2/P3）/建议废弃（与活循环重复的，如 rumination 死触发点——意识循环已有活触发）。满足 migration-orphan-audit 铁律。

## 不做（YAGNI）

- 不做 cron 表达式、不做 job 动态注册 API、不做并行执行
- 不删任何 executeTick 代码，不动 tick-scheduler/dispatcher 派发逻辑
- 不迁移其余 20+ job（清单标注归属，随 P2/P3 各期迁移）
- battle-report job 不在本 PR（生成器属 P2，届时注册表加一行即可）

## 测试策略（unit 档，vitest + mock pool，参考 __tests__/daily-review-scheduler.test.js）

新文件 `packages/brain/src/__tests__/scheduler-jobs.test.js`：
1. `runSchedulerJobsOnce` 调用全部 4 个 job，needsPool=true 的收到 pool、false 的无参调用
2. 单 job reject → 其余 job 照常执行 + 对应哨兵记录 ok:false
3. timeout：handler 永挂（timeoutMs=10）→ 返回 timedOut 标记、循环继续、不抛
4. 哨兵 SQL 形态：ON CONFLICT upsert、key=`scheduler_job_last_run:<name>`
5. 哨兵写入自身失败 → 不影响 job 结果与后续 job

真环境验证（铁律：真环境验证才算 done，merge 后 Gate3 自动部署时执行）：
- `docker logs` 含 `[Server] scheduler-jobs started`
- `working_memory` 出现 4 个 `scheduler_job_last_run:*` key
- 下一个 4h UTC 窗口后 `tasks` 表出现新 arch_review 任务（trigger_source='brain_auto'）

## 风险

- strategy-trigger 创建 P0 任务：当前 active objectives=2 → gate 挡住不会误触发；单测覆盖 gate 路径（mock COUNT>0）
- 4 个复活 job 的下游行为（arch_review 任务被 executor 消费、capture atoms 进 pending_review）均为既有已验证路径，本 PR 不改
