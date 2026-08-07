# Architecture: 执行者活性合同统一(executor_kind)

Initiative: a2953ddc-aba2-4e5a-aa8c-13889a280b85 | 设计日期: 2026-07-10 | 输入: memory `brain-harness-split-brain-audit` / `headed-dev-parallel-dispatch-incident` / `zombie-reaper-false-kill-dev-tasks`

## 概述

Brain 的守护器官(reaper/watchdog/sweep/healing)至今用一条 2025 年的公理判活:"任务 = Brain 本地进程,活性 = tasks.updated_at 有没有动"。harness 通过逐个豁免 + 专属看门狗自建了现代模型,但 dev/有头/bridge/外部 worker 仍被旧公理管辖且没有任何活性通道,造成结构性误杀(07-06 与 07-10 两次任务误杀、07-10 两次工作中 worktree 被删、有头 /dev 被 dispatcher 抢跑重复开发)。

本设计把"执行者是谁、怎么证明活着、死了怎么处置"收敛为**一个查询表 + 一个合同模块**:tasks 表新增 `executor_kind` 列,在所有派发/认领点打标;新模块 `executor-contracts.js` 为每类执行者定义活性探针与超时处置;四把守护刀改为查合同判活,删除全部硬编码 task_type 豁免清单。附带三项协议收口:认领协议统一、pre-flight 三振持久终结、dev 派发迁离 LangGraph(顺带打通 dev 的活性信号,并为刀4 拔除 @langchain/langgraph 扫清最大活引用)。

## 数据模型变更

migration 328(下一个空位):

```sql
ALTER TABLE tasks ADD COLUMN executor_kind TEXT
  CHECK (executor_kind IS NULL OR executor_kind IN
    ('brain-local','relay-container','headed-session','bridge','external-worker'));
CREATE INDEX idx_tasks_executor_kind ON tasks(executor_kind) WHERE status = 'in_progress';
```

- NULL = legacy/未打标,守护刀按"unknown"处理(fail-open,只告警不杀)
- 不建 DB 层合同表:合同是代码行为,与守护刀同仓同版本演进,放 `executor-contracts.js`

## 五类执行者与活性合同

| executor_kind | 谁 | 活性探针(probe) | staleness 判据 | onStale 处置 |
|---|---|---|---|---|
| `brain-local` | Brain spawn 的本地进程(cecelia-run/codex exec) | activeProcesses / lock slot pid `kill -0` | 进程死 且 updated_at > 60min | 标 failed(reaper 现行为,仅限此 kind) |
| `relay-container` | skill-relay docker/tmux session | `docker ps` 容器存活 + PR 状态反查(现 relay-watchdog 逻辑) | 容器消失且 PR 未 merge | 有界重点火(attempt cap,现行为不变) |
| `headed-session` | 交互 claude 认领的任务 | claimed_by 进程/tmux 存活 + worktree git/CI 活动(复用 pipeline-patrol hasRecentGitActivity/hasRecentCiActivity) | 探针三路全死 > 120min | **绝不自动标 failed**;释放 claim 回 queued + 飞书告警 |
| `bridge` | cecelia-bridge 派发(initiative_plan/verify 等) | bridge 回调/execution_attempts 递增(executor.js:3376 已写) | last_attempt_at > DECOMP_LIVENESS_GRACE(现 60min) | requeue(现行为收编进合同) |
| `external-worker` | ZJ pipeline-worker 等外部编排 | 无(外部系统负责) | 永不 | 永不(等回调;deadline 由外部系统管) |

合同模块接口(packages/brain/src/executor-contracts.js):

```js
export const EXECUTOR_CONTRACTS = {
  'brain-local':    { probe, staleMinutes: 60,  onStale: 'fail' },
  'relay-container':{ probe, staleMinutes: null, onStale: 'reignite' },  // relay-watchdog 专管
  'headed-session': { probe, staleMinutes: 120, onStale: 'release-claim-and-alert' },
  'bridge':         { probe, staleMinutes: 60,  onStale: 'requeue' },
  'external-worker':{ probe: async () => 'alive', staleMinutes: null, onStale: 'never' },
};
// probe(task, ctx) → 'alive' | 'dead' | 'unknown';unknown 一律 fail-open(不杀 + console.warn + cecelia_events)
export async function assessTaskLiveness(task, ctx) { /* 守护刀唯一入口 */ }
```

## 模块变更

| 模块 | 变更 | 说明 |
|---|---|---|
| migrations/328_executor_kind.sql | 新建 | 列 + check + 部分索引 |
| src/executor-contracts.js | 新建 | 合同表 + assessTaskLiveness + 五个 probe |
| src/dispatcher.js | 修改 | claim 成功后按分叉打标;pre-flight 三振(见下) |
| src/executor.js | 修改 | triggerCeceliaRun 内 harness_initiative→relay-container(:3193)、bridge 分支→bridge(:3253)、本地 spawn→brain-local(:2723);content-pipeline→external-worker |
| src/routes/tasks.js | 修改 | PATCH →in_progress 时自动 claimed_by=COALESCE(claimed_by,'session:'+来源标识) + executor_kind='headed-session'(:349 处) |
| src/routes/task-tasks.js | 修改 | POST /:id/claim 接受可选 executor_kind(默认 headed-session)(:331) |
| src/zombie-reaper.js | 重写判活 | SELECT 只取 in_progress,逐个 assessTaskLiveness;删 DEFAULT_EXEMPT_TASK_TYPES(:37) |
| src/tick-helpers.js | 修改 | autoFailTimedOutTasks(:117) 改查合同;killProcess 仅对 brain-local;删 HARNESS_TASK_TYPES 排除表 |
| src/tick-runner.js | 修改 | dead-reset(:1297)改:仅对 executor_kind IN ('brain-local','bridge') 且 probe=dead 生效;删 skill-relay 特判 |
| src/alertness/healing.js | 修改 | restartStuckExecutors(:614) 改查合同;删 content-pipeline 特判 |
| src/zombie-sweep.js + src/zombie-cleaner.js | 修改 | Guard C(见下),Guard A 保留 |
| src/pre-flight-check.js + dispatcher.js:388 | 修改 | 三振持久终结(见下) |
| src/workflows/dev-task.graph.js + orchestrator 引用 | 删除/绕过 | dev 派发迁离 LangGraph(见下) |

## 关键决策

| 决策 | 选项A | 选项B | 选择 | 理由 |
|---|---|---|---|---|
| 合同存哪 | DB 表 | 代码模块 | **B** | 合同=行为,与守护刀同版本演进;DB 表会产生第二个漂移源 |
| unknown 怎么办 | 按旧判据兜底 | fail-open 只告警 | **B** | 全部事故都是误杀方向;宁可漏杀(有告警)不误杀 |
| headed-session 超时 | 自动 failed | 释放 claim 回 queued + 告警 | **B** | 有头会话死=用户走了,任务本身没坏;failed 误导统计且需人工纠正(07-06/07-10 实证) |
| worktree 保护 | 只修 Guard A 语义 | Guard C 新增"活进程持有"检查 | **B** | "全 commit=干净可删"是 Guard A 的语义盲区,补语义不如加正交信号(进程 cwd 前缀匹配) |
| dev 迁移目标 | 折回 triggerCeceliaRun 本地 spawn | 重写新 runtime | **A** | triggerCeceliaRun 已有 execution_attempts/last_attempt_at/updated_at 写入(:3376),折回即自动接通活性信号,零新件 |
| consciousness.graph | 本次一起去图化 | 留给刀4 后续 | **B(不做)** | 与任务活性无关,独立 20min loop,混进来扩大爆炸半径 |
| pre-flight 三振后 | status=failed | status=blocked + blocked_reason | **B** | failed 是终态进不了修复流;blocked 可被"补 description 后 PATCH"复活,语义准确 |

## Guard C(worktree 收割第三道守卫)

在 zombie-sweep sweepStaleWorktrees(:99) 与 zombie-cleaner cleanupOrphanWorktrees(:153) 的删除动作前(Guard A 之后)增加:

1. **owning-task 检查**:worktree 分支名/.dev-lock 归属的任务若 status='in_progress' 或 claimed_by 非空 → skip
2. **活进程持有检查**:发现任何存活进程 cwd 在该 worktree 内(macOS lsof -a -d cwd 或逐进程 cwd 前缀匹配)→ skip
3. 两项检查自身失败 → 保守 skip(与 Guard A 同原则)

## pre-flight 三振持久终结

dispatcher.js:388 拒绝块改为:metadata 累加 pre_flight_fail_count;strikes >= 3 时 UPDATE status='blocked', blocked_reason='pre_flight_rejected', blocked_detail={issues,suggestions,strikes},告警一次后因 blocked 不再入候选自然止血。selectNextDispatchableTask 无需改。复活路径:PATCH 补 description → 回 queued 时清零计数。

## dev 派发迁离 LangGraph

- 删 dispatcher.js:648-649 的 _dispatchViaWorkflowRuntime 调用与函数(:788),dev 任务与其他类型一样走 triggerCeceliaRun(executor.js:3090)——其本地 spawn 分支已具备完整活性信号写入
- workflows/index.js:25-27 移除 dev-task 注册;物理删 workflows/dev-task.graph.js
- @langchain/langgraph 依赖保留(consciousness.graph 仍用,刀4 后续拔)
- 回归关键点:dev 的 execution_attempts 从恒 0 变为递增 → dead-reset(:1297) 对 dev 不再空转误伤(与守护刀合同化互为双保险)

## 测试策略

- 每 task 独立 vitest(mock pool/进程探针),严格 TDD 两段 commit
- 合同模块:五 kind × alive/dead/unknown 矩阵单测;unknown fail-open 必测
- 守护刀改造:各保留一条"改造前会误杀、改造后不杀"回归用例(用 07-10 事故真实参数:headed-session + updated_at 63min + 进程活)
- Guard C:临时目录造 worktree + 假进程 cwd,断言 skip;进程死断言可删
- dev 迁移:integration 级——mock spawn,断言 dev 派发走 triggerCeceliaRun 且 execution_attempts+1
- 禁全量 brain vitest(环境级 OOM),CI 靠既有 shard

## headed_manual 消费语义与零留痕堵死（task 94ee0ec4，2026-08-07）

事故 b35bfa0c：payload.headed_manual=true 的任务被无头派发后零留痕滞留 in_progress，
被 liveness 双确认按 never_started 假杀。三层修复（decisions 拍板 433fb902，消费方向）：

1. **headed_manual 派发排除**：`selectNextDispatchableTask`（dispatch-helpers.js）派发谓词
   排除 `payload->>'headed_manual' = 'true'`（jsonb 布尔与字符串 true 均识别）——该旗标任务
   留给有头人工执行，不进无头自动派发；status 保持 queued 等待。
2. **kill 授权 spawn 证据校验（零留痕堵死）**：probeTaskLiveness 双确认 DEAD 后，仅当存在
   任一正向 spawn 证据（activeProcesses 条目 / /tmp/cecelia-{id}.log）或派发回执
   （error_message）才允许进入 never_started/process_disappeared kill 分类；零证据任务
   → 安全回队（status=queued，不写 watchdog_kill / error_message / failure learning），
   并落 task_events 留痕行（watchdog_safe_requeue / watchdog_headed_requeue）。
   started_at 单独不可靠（requeue 清空，1dfa40f7 实证），不作为证据。
3. **处置与 spawn 失败必须留痕（fail-closed）**：watchdog 任何处置（requeue/quarantine/
   安全回队）落 task_events 行（lib/task-event-log.js recordTaskEventSafe，写失败仅告警
   不阻断）；dispatcher claim 后失败路径 recordDispatchResult 全部带 task_id 写
   dispatch_events，triggerCeceliaRun spawn 失败另落 task_events(failed_dispatch) 行——
   杜绝零留痕。

回归护栏（永久入 CI，liveness-queued-never-spawned.integration.test.js）：带派发失败回执的
从未启动任务仍分类 never_started；曾启动（进程日志存在）任务进程消失仍判 process_disappeared
——只堵假杀，不放过真死。
