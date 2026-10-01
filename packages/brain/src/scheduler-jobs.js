/**
 * scheduler-jobs.js — 声明式定时任务注册表（作战循环 P1-PR1）
 *
 * Wave 2（2026-05-04）后 executeTick 死掉的定时任务的恢复通道。
 * 调度模型：统一 60s 轮询 + 模块自 gate —— 每轮无脑调用所有 job，
 * "该不该真正执行"由各 handler 内置窗口/幂等逻辑决定（triggerArchReview
 * 自带 4h 窗口+recent 去重+guard；maybeTriggerStrategySession 自带
 * active_goals gate+24h 冷却）。注册表只负责：错误隔离、timeout、观测哨兵。
 * 哨兵只作观测（死人开关/战报查"最近一跑"），幂等由模块自 gate 负责。
 */
import { triggerArchReview, triggerCiPatrol } from './daily-review-scheduler.js';
import { maybeTriggerStrategySession } from './active-goals-zero-trigger.js';
import { scheduleDailyBackup } from './daily-backup-scheduler.js';
import { maybeRunLineDreaming } from './line-dreaming.js';
import { maybeGenerateBattleReport } from './battle-report.js';
import { maybeRunLedgerHygiene } from './ledger-hygiene.js';
import { runCaptureTriage } from './capture-triage.js';
import { runReceiptCollector } from './receipt-collector.js';
import { runWorkerPoolDispatch } from './worker-pool-dispatch.js';
import { runLaunchdPatrol } from './launchd-patrol.js';
import { runGpShelfLife } from './gp-shelf-life.js';
import { maybeRefreshMapProjections } from './map-projection-refresh.js';
import { maybeRunDirectionProposer } from './direction-proposer.js';
import { runPostdeployVerifier } from './postdeploy-verifier.js';
import { runSevenRingAuditJob } from './seven-ring-audit.js';
import { runGuardDrill } from './guard-drill.js';
import { runMorningCockpitBark } from './morning-cockpit-bark.js';
import { runDriftSentinel } from './cron/drift-sentinel.js';
import { runDiskGuard } from './cron/disk-guard.js';
import { runPromiseMapNightly } from './promise-map-nightly.js';
import { runRescanStalenessPatrol } from './cron/rescan-staleness-patrol.js';
import { sampleMachineVitals } from './machine-vitals.js';
import { runCodexTestGen } from './codex-test-gen.js';
import { runCaptureAging } from './capture-aging.js';
import { runAcceptanceAging } from './acceptance-aging.js';
import { runConversationCapture } from './conversation-capture.js';
import { maybeRunTriageOfficerRank } from './triage-officer-rank.js';
import { runTriageOfficer15min } from './triage-officer-15min.js';
import { runConversationTtlArchiver } from './conversation-ttl-archiver.js';
import { runNotionCaptureIngest } from './notion-capture-ingest.js';
import { runNotionProductPush } from './notion-inbox-push.js';
import { runNotionVerdictIngest } from './notion-verdict-ingest.js';
import { applyProjectionCommands } from './projection/commands.js';
import { runProjectionOutbox } from './projection/outbox.js';
import { runNotionTaskCommandIngest } from './projection/notion.js';
import { runOpsCollector } from './ops-collector.js';
import { runSchedulerLiveness } from './ops-scheduler-liveness.js';
import { runWorkflowRunLostDeadline } from './workflow-run-lost-deadline.js';
import { runCommanderWatchdog, runWorkflowTrendBark } from './commander-watchdog.js';
import { runModelAccountsCollector } from './ops-model-accounts-collector.js';
import { runOpenclawGuards } from './openclaw-guards.js';
import { maybeRunFeishuTaskLedger } from './feishu-task-ledger.js';
import { maybeRunCredentialFreshness } from './credential-freshness.js';
import { raise as raiseAlert, flushAlertsIfNeeded } from './alerting.js';
import { runOpsNotionPush } from './notion-push-sync.js';
import { runOpsNotionIngest } from './ops-notion-ingest.js';
import { runNotionInletIngest } from './notion-inlet-ingest.js';
import { gtdSyncJobHandler } from './notion-gtd-sync.js';
import { defaultExec } from './host-exec.js';
import { maybeRunCrystalJudge } from './crystal-judge.js';
import { reapOpenclawAgentRuns } from './openclaw-agent-executor.js';
import { reapScriptRuns } from './script-executor.js';
import { reconcileDelegatedDeviceJobs } from './routing/device-delegation.js';
import { syncCodingEvidence } from './crystal/coding-evidence.js';
import { runOwnerDecisionDeadline } from './owner-decision-deadline.js';
import { runSkillDistDrift } from './skill-dist-drift.js';
import { runSkillInventorySync } from './skill-inventory-sync.js';
import { runSkillRegistryProjection } from './skill-registry-projection.js';
import { runBackboneContractJob } from './activity-contract-sync.js';
import { runMirrorLabelJob } from './notion-mirror-labels.js';
import { runPhoneRegistrySync } from './phone-registry-sync.js';
import { runRecurringTasksJob } from './recurring.js';

const LOOP_INTERVAL_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const SENTINEL_KEY_PREFIX = 'scheduler_job_last_run:';

export const JOBS = [
  // machine-vitals 必须排首位：串行轮内后面 19 个 job 的延迟会把采样推过 STALE_MS(180s)，
  // harness 派发热路径读到的就是过期缓存（beeba317 终审 Fix 3）。
  { name: 'machine-vitals', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => sampleMachineVitals(pool), description: '本机体征采样（docker容器数/VM内存/盘，60s，harness admission 数据源，beeba317）' },
  { name: 'arch-review', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: triggerArchReview, description: '架构巡检（自带4h窗口+guard）' },
  { name: 'ci-patrol', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: triggerCiPatrol, description: 'CI/CD 巡检（自带北京08:00窗口+当日去重）' },
  { name: 'strategy-trigger', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeTriggerStrategySession, description: '战略会应急触发（自带active_goals gate+24h冷却）' },
  { name: 'daily-backup', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: scheduleDailyBackup, description: '每日 DB 备份任务创建（自带窗口+当日去重；作战史单库保命符）' },
  { name: 'line-dreaming', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRunLineDreaming, description: 'L1 line 级夜间蒸馏（自带北京05:00窗口+20h去重，晨报前跑完）' },
  { name: 'ledger-hygiene', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRunLedgerHygiene, description: '账本保鲜守卫（自带北京05:10窗口+20h去重，m1-m7指标+棘轮击穿开issue）' },
  { name: 'battle-report', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeGenerateBattleReport, description: '作战日报（北京06:00窗口+当日去重自 gate）' },
  { name: 'capture-triage', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runCaptureTriage, description: '收件箱四路分诊（自带10min间隔gate+批量上限，T10）' },
  { name: 'receipt-collector', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runReceiptCollector, description: '回执核销（自带10min间隔gate，pending超30min标timeout，T4）' },
  { name: 'worker-pool-dispatch', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => runWorkerPoolDispatch(pool), description: 'worker池自动派发（自带5min gate；queued的parallel_worker/exploratory任务→tmux slot7-9发射交互/dev，并发上限2，任务873acc6d）' },
  { name: 'map-projection-refresh', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRefreshMapProjections, description: '地图投影保鲜：fact_snapshot_headers 与 active 投影 fact_revisions 漂移即 rebuild（自带3min gate；09-05/06 map_radius_stale 案，决策 8f22f71c）' },
  { name: 'gp-shelf-life', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runGpShelfLife, description: 'GP 保质期 delta（自带10min gate，approved 超 review_after 置 expired；报备否决窗过期自动生效，GP1/T1）' },
  { name: 'launchd-patrol', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runLaunchdPatrol, description: '宿主 launchd 服务巡检（自带15min gate，manifest核对，异常P1+Bark，a5a6209a）' },
  { name: 'direction-proposer', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRunDirectionProposer, description: '每周方向菜单（自带北京周一05:30窗口+20h去重，候选写golden_paths+缺口全景写working_memory，GP4/T4）' },
  { name: 'postdeploy-verifier', needsPool: true, timeoutMs: 2 * 60 * 1000, handler: runPostdeployVerifier, description: '第5环部署验证（自带5min节流gate，扫 pending_postdeploy 任务执行 postdeploy_check.command，通过→completed，失败3次→P1）' },
  { name: 'seven-ring-audit', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runSevenRingAuditJob, description: '七环对账日巡检（自带24h冷却，逐环核对测试入册/调度在跑/指纹新鲜/账本写对/产出消费/告警活着/面板新鲜，棘轮只许降，刀3-T6）' },
  { name: 'guard-drill', needsPool: true, timeoutMs: 10 * 60 * 1000, handler: runGuardDrill, description: '月度守卫演习（自带30天gate，轮选 auto 守卫全流程弄死→验红→恢复，未叫→P1+Bark，刀4-T4）' },
  { name: 'morning-cockpit-bark', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runMorningCockpitBark, description: '主理人指挥舱晨报 Bark（北京08:30窗口+当日去重，推送指挥舱链接+完成率/任务数简报，task:80a5be84）' },
  { name: 'drift-sentinel', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runDriftSentinel, description: 'G2 部署漂移哨兵（自带30min自gate，SHA对账+自动补部署，G2 S0）' },
  { name: 'disk-guard', needsPool: false, timeoutMs: 120_000, handler: runDiskGuard, description: '磁盘哨兵（15min自gate，宿主SSH逃逸df检测，80/85/90%三级响应，[disk_check]日志）' },
  { name: 'promise-map-nightly', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runPromiseMapNightly, description: 'MJ5 S4 承诺地图保鲜对账（每日 UTC 02:00，4 条断言，失败 Bark，刀4）' },
  { name: 'rescan-staleness-patrol', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => runRescanStalenessPatrol(pool), description: '地图照相层 rescan 停滞哨兵（自带5min gate，fact_snapshot_headers 账龄>30min即 P1+晨报AMBER，与派发闸账龄预算同源，P0 9dfd873a 案）' },
  { name: 'codex-test-gen', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => runCodexTestGen(pool), description: 'Codex 每日测试补齐生成器（扫 brain/src 缺测试文件 → 去重 7 天 → 入队 1-3 个 codex_test_gen 任务，07172225）' },
  { name: 'capture-aging', needsPool: true, timeoutMs: 30_000, handler: runCaptureAging, description: '账龄哨兵：超7天告警+llm_failed重试(≤3次)+超限转parked' },
  { name: 'acceptance-aging', needsPool: true, timeoutMs: 30_000, handler: runAcceptanceAging, description: '验收超时哨兵：pending/in_review超48h红灯Bark验收人+其中pending转expired(A10②)+历史failed无驳回任务补偿扫描（1h自gate，主理人条件一，决策18174291）' },
  { name: 'triage-officer-rank', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRunTriageOfficerRank, description: '排序官每日大轮（北京07:00产能感知排序，晨报前1.5h，Top N榜单+两层预算+否决窗90min）' },
  { name: 'triage-officer-15min', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runTriageOfficer15min, description: '排序官15min规则小轮（纯SQL精确重名归并+否决窗过期自动放行，不走LLM）' },
  { name: 'conversation-capture', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: async (pool) => {
    const r = await runConversationCapture(pool);
    if (r?.ok === false) throw new Error(r.error || 'conversation-capture failed');
    // pushCapture 永不抛出，写入失败只体现在 r.errors 上；不检查这里会让
    // 部分失败的跑（有 pushed 也有 errors）在哨兵里显示为纯绿，重演历史事故
    // （相似功能静默丢数据 4 个月无人发现）。errors>0 必须让本轮 job 记为失败，
    // 才能被 seven-ring-audit / capture-aging 告警层读到。
    if (r?.errors > 0) throw new Error(`conversation-capture: ${r.errors} 条写入失败（已推送 ${r.pushed ?? 0} 条）`);
    return r;
  }, description: '对话原始捕获：机械过滤~/.claude/projects/*.jsonl真人文本写入captures(source=conversation)，自带10min间隔gate（decision f64adaaf/0c9e1652）' },
  { name: 'conversation-ttl-archiver', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runConversationTtlArchiver, description: '主理人对话 TTL 归档：ttl_expires_at 到期的 active/suspended 对话软归档（10min 自gate，PR4/4 64b8c8d）' },
  { name: 'notion-capture-ingest', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runNotionCaptureIngest, description: 'Notion 个人 Inbox 增量采集：5min自gate，last_edited_time增量+notion_page_id幂等，写入captures+capture_atoms（F6加厚，CCAPI2026）' },
  { name: 'notion-product-push', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: async (pool) => runNotionProductPush(pool), description: '成品呈报到 Notion Inbox；稳定 dedupe_key 幂等并回写 tasks.notion_id' },
  { name: 'notion-verdict-ingest', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: async (pool) => runNotionVerdictIngest(pool), description: 'Notion 裁决窄口：只登记结构化 projection command，不直接改任务执行态' },
  { name: 'notion-task-command-ingest', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runNotionTaskCommandIngest, description: 'Notion Tasks 结构化回读：In Progress/Start → start_requested' },
  { name: 'projection-command-apply', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: applyProjectionCommands, description: 'Brain 状态机校验并应用 projection commands；真实 attempt 才能进入 in_progress' },
  { name: 'projection-outbox', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runProjectionOutbox, description: '本地数据库到 Notion/Obsidian 等可拆卸 projection 的通用 outbox' },
  { name: 'ops-collector', needsPool: true, timeoutMs: 120_000, handler: (pool) => runOpsCollector(pool), description: '运行舱采集器（5min自gate，宿主launchctl+HK OpenClaw+GHA cron→ops_*投影，per-source心跳，G1 S1 刀1，task 6fcb5356）' },
  {
    name: 'ops-model-accounts-collector',
    needsPool: true,
    timeoutMs: 120_000,
    handler: (pool) => runModelAccountsCollector(pool, {
      onAlert: ({ account_id, status, last_error, consecutive_failures }) => raiseAlert(
        'P2',
        `model_account_collect_failed_${account_id}`,
        `📉 ${account_id} 配额采集连续 ${consecutive_failures} 轮失败（status=${status}）：${last_error ?? 'n/a'}`,
      ).catch(() => {}),
    }),
    description: '模型账号配额采集（8 账号：Claude×2/Codex×5/Grok，host-exec 到 mmv 跑 usage 探针只回 usage JSON→ops_model_accounts，G1 刀2；PR #5411 漏接线，task eb2f582f）。自 gate 5min + 单轮总预算 60s + 异步 exec（不阻塞事件循环）+ 失败不擦白 pct、连续 3 轮才告警（刀0 止血，task 424d9dd2）',
  },
  { name: 'openclaw-guards', needsPool: true, timeoutMs: 180_000, handler: (pool) => runOpenclawGuards(pool, { raiseFn: raiseAlert }), description: 'us-vps 零执行守卫（决策95477a66收编）：网关内存回收/配置漂移还原/agent教义补种/会话跑场探活路由/触达线活性告警，5min自gate，前身为宿主散装crontab' },
  { name: 'feishu-task-ledger', needsPool: true, timeoutMs: 120_000, handler: (pool) => maybeRunFeishuTaskLedger(pool), description: '飞书群交办入账（决策1c6679cd）：群里派给秋米的活经三道判据（@对象/语义/重发去重）入 tasks 账并投影 Notion，自 gate 60min' },
  { name: 'credential-freshness', needsPool: true, timeoutMs: 120_000, handler: (pool) => maybeRunCredentialFreshness(pool), description: '凭据保鲜守卫：每日探活关键凭据(Tailscale/GitHub/飞书)+到期体检+auth key 自动续期。2026-09-16 实证 Tailscale API key 过期 18 天无人知、备用 PAT 元数据没写却已 401 —— 元数据只是声明，活性探测才是真相' },
  // 顺序要紧：先采集再推送，否则推的是上一轮的旧数（尤其 liveness 要用最新 last_run_at 算）
  { name: 'ops-notion-push', needsPool: true, timeoutMs: 120_000, handler: (pool) => runOpsNotionPush(pool), description: '运行舱四表推 Notion 驾驶舱（机器列单向覆盖含活性告警）。旧链挂在无人import的legacy-notion-push-scheduler上从不执行，致Notion停更两天，故单独接现代调度层' },
  { name: 'notion-inlet-ingest', needsPool: true, timeoutMs: 120_000, handler: (pool) => runNotionInletIngest(pool), description: '✍️入口血管（三面模型PR②b，决策297ffee5）：遍历注册表 face=inlet&active 的库，「决策」库→decisions、员工Skill库zip→/api/skill-eval/upload；收据表幂等，人改了再收并留痕，机器不写入口库；自gate 5min' },
  { name: 'notion-gtd-sync', needsPool: true, timeoutMs: 30_000, livenessIntervalSec: 30, handler: (pool) => gtdSyncJobHandler(pool), description: '秋米中文GTD表↔英文Tasks库双向同步+入账+急停+回写（QIUMI_SYNC_ENABLED 门，handler 只确保 30s 自循环在跑并回报上次结果；活性按 handler 自报 liveness_at 算，09-24 卡死案；决策 b8abd28c，task b7efdbff）' },
  { name: 'ops-notion-ingest', needsPool: true, timeoutMs: 120_000, handler: (pool) => runOpsNotionIngest(pool, { execFn: defaultExec }), description: '运行舱人工列回读（Notion→Brain，last_edited_time增量）。含停用意图落实——主理人拍板直接生效真停n8n，故幂等+留痕+失败落enable_error显红' },
  // 顺序要紧：先把编码线格子成败搬进判官口粮，再让判官判——反过来判的是上一轮的旧账
  { name: 'crystal-coding-evidence', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => syncCodingEvidence({ dbPool: pool }), description: '编码线九格证据同步（10min自gate，harness_attempts+sequencer_ledger→crystal_run_evidence，只补账不代判，判官口粮第二铲）' },
  { name: 'crystal-judge', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => maybeRunCrystalJudge(pool), description: '每日结晶判官（北京05:00窗口+当日去重，OpenClaw 八格六指标聚合→三态判决→每日结晶报告落库，Crystal 第4件）' },
  { name: 'openclaw-agent-reaper', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => reapOpenclawAgentRuns(pool), description: '秋米 openclaw-agent 收割（60s，读 MMV ~/brain-runs/<run_id>.exit → completed_no_pr/failed，PR3）' },
  { name: 'script-reaper', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => reapScriptRuns(pool), description: 'executor=script 收割（60s，读跑场机 ~/brain-runs/<run_id>.exit → completed / 按 retry-policy 重排一次 / failed 带 exit code 与截断 stderr，链 bf5088a3 棒3）' },
  { name: 'qiumi-device-reconcile', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => reconcileDelegatedDeviceJobs(pool), description: '秋米设备任务对账（60s，子 device_job 终态回写父 qiumi_task，PR3 补充五）' },
  { name: 'owner-decision-deadline', needsPool: true, timeoutMs: 120_000, livenessIntervalSec: 60, handler: (pool) => runOwnerDecisionDeadline(pool), description: '主理人决策到期兑现（决策105a5868三档协议，任务8aa79219）：blocked owner_decision(waiting_on=human)到期未应答→可逆按default走(同批准同一内部函数，via=default_on_deadline，decisions made_by=system，Bark P2「可推翻」)；不可逆不自动执行→blocked_until顺延24h+留痕次数+Bark P1再催。进程内10min自gate，调度轮60s都会调用故活性尺子=60s；整轮有界（query_timeout/statement_timeout/取连接超时/90s预算），不重演09-24 notion-gtd-sync卡死案' },
  { name: 'skill-dist-drift', needsPool: true, timeoutMs: 120_000, livenessIntervalSec: 60, handler: (pool) => runSkillDistDrift(pool), description: 'skill 分发漂移检测（链 bf5088a3 棒8，任务 1141f101）：真身 MMV ~/.claude/skills 与跑场机 xian-m4/xian-m1 的 skill 清单哈希（跟随符号链接按内容算，悬空链接单列）30min 自 gate 比对，结果写 working_memory.skill_manifest_drift，晨报/日报出 🟡 AMBER。us-vps 零执行：只经 ssh(mmv 跳板) 送脚本到目标机执行、读回 JSON；ssh 失败/超时=unreachable（未核对），绝不当零个 skill' },
  { name: 'skill-inventory-sync', needsPool: true, timeoutMs: 200_000, livenessIntervalSec: 60, handler: (pool) => runSkillInventorySync(pool), description: 'skill 三平台扫描入账（Skill 台账投影 PR1a，任务 47def5bb，决策 19391396）：2h 自 gate + advisory lock，经 ssh mmv 送自包含 node 采集程序扫 ~/.claude/skills、OpenClaw 各 agent 实际加载、~/.agents/skills、zenithjoy-skills 仓库，归并写 skill_registry 机器列与 presence（人管列/status 不碰）；探不到≠零个：来源 fail/跑场机清单过期/骤降>10% 熔断时不判缺席，缺席满 24h 才 gone，断链即 broken' },
  { name: 'skill-registry-projection', needsPool: true, timeoutMs: 120_000, livenessIntervalSec: 60, handler: (pool) => runSkillRegistryProjection(pool), description: 'skill_registry → Notion Skill Registry 投影（Skill 台账投影 PR1b，任务 47def5bb，决策 19391396）：2min 自 gate + advisory lock，每轮最多 25 行；列账按列 id 认列（人改名照写、人删列不补建、改类型跳过），机器列单向覆盖，人管列三方基线合并（人改过的不覆盖，判定点 24736022）；建页前按标题查重认领，失败指数退避不解绑，每日归档机器人建的孤儿页。取代 notion-push-sync.pushSkillRegistry' },
  { name: 'recurring-tasks', needsPool: true, timeoutMs: 120_000, handler: (pool) => runRecurringTasksJob(pool), description: 'recurring_tasks 定时引擎（任务 3d0db274，5 月起停摆复活：原只挂在废弃 executeTick）：每轮扫活模板，北京时区（template.timezone 可覆盖）、next_run_at 到点即建单；首次启用只写基线不补跑；迟到超 catchup_minutes(默认30) 记 missed+P2；CAS 占位防重、source_id=recurring:<id>:<时间点>；同模板有未完结实例跳过、连续3次告警；透传 assigned_to/due_at/过期，过期未认领取消；落后>10min 告警' },
  { name: 'alerting-flush', needsPool: false, timeoutMs: 120_000, handler: () => flushAlertsIfNeeded(), description: 'P1 每小时/P2 每日告警汇总推飞书（任务 309d864c：原只挂在废弃 executeTick，5 月起从未 flush；缓冲与上次刷新时间落 working_memory.alerting_buffers，部署重启不丢）' },
  // 放末尾：第一轮串行跑到这里时前面所有 job 的哨兵都已刷新，重启后不会把后排 job 误判 dead 再"恢复"。JOBS 经闭包注入——
  // 本模块已 import ops-collector/notion-push-sync，反向 import 会成环（routes/sentinel.js 同款避坑）。
  // scheduler 行推 Notion 滞后一轮 60s，设计 §3.2 接受。
  { name: 'backbone-contract-sync', needsPool: true, timeoutMs: 120_000, livenessIntervalSec: 60, handler: (pool) => runBackboneContractJob(pool), description: '主干活动契约 git→Brain→Notion（决策 0834e2fb / 92f6226b，任务 2fdd5f12）：真身 zenithjoy-workspace product-map/contracts/*.yaml，30min 自 gate 只读 GitHub API 比 contracts.json 活动哈希，变了才拉 YAML 写 journey_steps 只读副本（钉 commit 的正本链接），仓库删掉的活动标 deprecated；每轮把变更行推 Notion「Backbone Activities」镜子；同步连续失败超 2h 告 P1 一次' },
  { name: 'phone-registry-sync', needsPool: true, timeoutMs: 180_000, livenessIntervalSec: 60, handler: pool => runPhoneRegistrySync(pool), description: '手机人写台账入口（任务cda0e3e8）：30min内容基线回灌；经MMV同代下发；每日持锁核验空闲设备账号，错号只提醒' },
  { name: 'notion-mirror-labels', needsPool: true, timeoutMs: 120_000, handler: (pool) => runMirrorLabelJob(pool), description: '镜子库只读说明由注册表生成（任务 a7a6b8b4，交接单第5步）：notion_projection_map 里 active 推送镜子的库描述开头写「🔒 只读镜子：由 Brain <表> 经 <血管> 推送…」，已是同样说明零写，两面库/无 Brain 表的跳过；进程内 20h 自 gate' },
  { name: 'workflow-run-lost-deadline', needsPool: true, timeoutMs: 120_000, handler: (pool) => runWorkflowRunLostDeadline(pool), description: '整批总时限到期判 lost（任务 c2d73868，决策 3c98fb36；09-30 三部手机各卡 6h 无人判死案）：in_progress 的 workflow_run / device_job 镜像(source=cron) 起跑超 4h+30min（env 可配）仍无 finalize → failed(lost_deadline) + task_events；善后 fail-open：ssh 执行机 douyin-phone-adb lock-release <TAG> / return-safe-desktop、MMV openclaw cron rm <escort>，只做一次；能力名只认 payload.wf_id 不认账本 run_id 前缀。5min 自 gate，单批 ≤20' },
  { name: 'commander-watchdog', needsPool: true, timeoutMs: 120_000, handler: (pool) => runCommanderWatchdog(pool), description: 'Commander 看门狗（任务 17ea4536，决策 3c98fb36；09-30 escort 02:52 被移除后 5h 无人陪跑案）：在途 workflow_run / device_job 镜像起跑 ≥15min 且 escort 心跳缺失/超 15min（心跳经 POST /commander-heartbeat 按 TAG 写 payload.commander_heartbeat_at）→ ssh 网关 openclaw cron rm 旧 escort + add 同名 escort-<host>-<TAG>（接班：只读账本与日志接上，不重发起），新 id 回写 payload，task_events commander_relaunched；同一 run 接班 ≥3 次 → Bark 一次并停拉。5min 自 gate，单批 ≤20' },
  { name: 'workflow-trend-bark', needsPool: true, timeoutMs: 60_000, handler: (pool) => runWorkflowTrendBark(pool), description: 'workflow 趋势 Bark（任务 17ea4536，PRD 叫人边界）：北京 08:30–10:00 窗口、working_memory 当日去重；同一 wf（payload.wf_id/capability/cap，不认账本 run_id 前缀）连续 2 个自然日有批但零线索 → Bark；一台 serial 近 72h 有批但 24h 无 completed → Bark。单批 0 线索/单次接班/单批 lost 不叫' },
  { name: 'scheduler-liveness', needsPool: true, timeoutMs: 60_000, handler: (pool) => runSchedulerLiveness(pool, { jobs: JOBS, self: 'scheduler-liveness' }), description: 'Brain 调度 job 入运行舱：working_memory 哨兵→ops_workflows(source=scheduler)，活性按声明间隔算，翻转 dead 按轮合并一条 Bark（无 BARK_TOKEN 兜底 P1）、恢复 P2（09-24 notion-gtd-sync 卡死 8.4h 无告警案，决策 69cd802f，task 50a2c256）' },
];

const PROJECTION_JOB_NAME_SET = new Set([
  'notion-task-command-ingest',
  'projection-command-apply',
  'projection-outbox',
]);

export const PROJECTION_JOBS = JOBS.filter(job => PROJECTION_JOB_NAME_SET.has(job.name));
export const SERIAL_JOBS = JOBS.filter(job => !PROJECTION_JOB_NAME_SET.has(job.name));

function raceWithTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __schedulerTimedOut: true }), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function summarize(result) {
  if (result == null) return null;
  try {
    const s = JSON.stringify(result);
    return s.length > 500 ? s.slice(0, 500) : s;
  } catch {
    return String(result).slice(0, 200);
  }
}

async function writeSentinelRaw(pool, key, record) {
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [key, JSON.stringify(record)],
    );
  } catch (e) {
    console.warn(`[scheduler-jobs] sentinel write failed for ${key}:`, e.message);
  }
}

function writeSentinel(pool, jobName, record) {
  return writeSentinelRaw(pool, `${SENTINEL_KEY_PREFIX}${jobName}`, record);
}

/**
 * 单发全部 job（供 loop 与测试）。单 job 失败/超时不影响其他 job。
 * @returns {Promise<Array<{name:string, at:string, ok:boolean}>>}
 */
export async function runSchedulerJobsOnce(pool, jobs = JOBS) {
  const results = [];
  for (const job of jobs) {
    const at = new Date().toISOString();
    let record;
    try {
      const invocation = job.needsPool ? job.handler(pool) : job.handler();
      const result = await raceWithTimeout(Promise.resolve(invocation), job.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (result && result.__schedulerTimedOut) {
        console.warn(`[scheduler-jobs] ${job.name} timed out after ${job.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
        record = { at, ok: false, timedOut: true };
      } else {
        record = { at, ok: true, detail: summarize(result) };
        // handler 自报的完成时刻（如 gtdSyncJobHandler 的内层循环最后一轮）。立即返回型 handler 的
        // 哨兵 `at` 每分钟都新，内层死了也新；scheduler-liveness 只认这个字段算活性。
        if (typeof result?.liveness_at === 'string') record.liveness_at = result.liveness_at;
      }
    } catch (e) {
      console.warn(`[scheduler-jobs] ${job.name} failed:`, e.message);
      record = { at, ok: false, error: e.message };
    }
    await writeSentinel(pool, job.name, record);
    results.push({ name: job.name, ...record });
  }
  return results;
}

let loopTimer = null;
let running = false;

/** 启动 60s 轮询 loop（幂等：重复调用返回同一 timer）。 */
export function startSchedulerJobsLoop(pool) {
  // Preview Brain 隔离闸：BRAIN_PREVIEW=1 时禁止启动 scheduler loop，防并发重复派发。
  // 与 harness-skill-relay.js:338 守卫条件保持一致（同样检查 '1' 和 'true'）。
  const preview = process.env.BRAIN_PREVIEW;
  if (preview === '1' || preview === 'true') {
    console.log('[scheduler-jobs] BRAIN_PREVIEW — scheduler loop skipped in preview mode');
    return null;
  }
  if (loopTimer) return loopTimer;
  // 供死人开关比对：预期 job 数写库，加 job 自动同步，哨兵脚本无需硬编码
  writeSentinelRaw(pool, 'scheduler_jobs_expected', { count: JOBS.length });
  loopTimer = setInterval(() => {
    // 重入守卫：一轮 job 最长可达 ~20min（4×5min timeout），慢 handler 会让
    // 60s tick 叠加并发调用同一 handler，踩中各模块自 gate 的先查后写(TOCTOU)竞态。
    if (running) return;
    running = true;
    runSchedulerJobsOnce(pool, SERIAL_JOBS)
      .catch((e) => console.warn('[scheduler-jobs] loop iteration failed:', e.message))
      .finally(() => { running = false; });
  }, LOOP_INTERVAL_MS);
  if (typeof loopTimer.unref === 'function') loopTimer.unref();
  console.log(`[scheduler-jobs] started (${LOOP_INTERVAL_MS / 1000}s loop, ${JOBS.length} jobs)`);
  return loopTimer;
}

/** 停止 loop（测试用）。 */
export function stopSchedulerJobsLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  running = false;
}

let projectionLoopTimer = null;
let projectionRunning = false;

function runProjectionIteration(pool, runOnce) {
  if (projectionRunning) return;
  projectionRunning = true;
  Promise.resolve(runOnce(pool, PROJECTION_JOBS))
    .catch((error) => console.warn('[projection-jobs] loop iteration failed:', error.message))
    .finally(() => { projectionRunning = false; });
}

/** 独立 projection loop：启动即跑，之后每 60s 一轮，不受慢速串行 job 阻塞。 */
export function startProjectionJobsLoop(pool, { runOnce = runSchedulerJobsOnce } = {}) {
  // Preview Brain 隔离闸：与 startSchedulerJobsLoop 守卫一致。
  const preview = process.env.BRAIN_PREVIEW;
  if (preview === '1' || preview === 'true') {
    console.log('[projection-jobs] BRAIN_PREVIEW — projection loop skipped in preview mode');
    return null;
  }
  if (projectionLoopTimer) return projectionLoopTimer;
  runProjectionIteration(pool, runOnce);
  projectionLoopTimer = setInterval(
    () => runProjectionIteration(pool, runOnce),
    LOOP_INTERVAL_MS,
  );
  if (typeof projectionLoopTimer.unref === 'function') projectionLoopTimer.unref();
  console.log(`[projection-jobs] started (${LOOP_INTERVAL_MS / 1000}s loop, ${PROJECTION_JOBS.length} jobs)`);
  return projectionLoopTimer;
}

/** 停止独立 projection loop（测试用）。 */
export function stopProjectionJobsLoop() {
  if (projectionLoopTimer) {
    clearInterval(projectionLoopTimer);
    projectionLoopTimer = null;
  }
  projectionRunning = false;
}
