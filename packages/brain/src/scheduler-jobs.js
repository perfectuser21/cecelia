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
import { runLaunchdPatrol } from './launchd-patrol.js';
import { runGpShelfLife } from './gp-shelf-life.js';
import { maybeRunDirectionProposer } from './direction-proposer.js';
import { runPostdeployVerifier } from './postdeploy-verifier.js';
import { runSevenRingAuditJob } from './seven-ring-audit.js';
import { runGuardDrill } from './guard-drill.js';
import { runMorningCockpitBark } from './morning-cockpit-bark.js';
import { runDriftSentinel } from './cron/drift-sentinel.js';
import { runDiskGuard } from './cron/disk-guard.js';
import { runPromiseMapNightly } from './promise-map-nightly.js';
import { sampleMachineVitals } from './machine-vitals.js';
import { runCodexTestGen } from './codex-test-gen.js';
import { runCaptureAging } from './capture-aging.js';
import { runAcceptanceAging } from './acceptance-aging.js';
import { runConversationCapture } from './conversation-capture.js';
import { maybeRunTriageOfficerRank } from './triage-officer-rank.js';
import { runTriageOfficer15min } from './triage-officer-15min.js';
import { runConversationTtlArchiver } from './conversation-ttl-archiver.js';
import { runNotionCaptureIngest } from './notion-capture-ingest.js';
import { pushProductToNotionInbox } from './notion-inbox-push.js';
import { consumeVerdictFromNotion } from './notion-verdict-ingest.js';

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
  { name: 'codex-test-gen', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => runCodexTestGen(pool), description: 'Codex 每日测试补齐生成器（扫 brain/src 缺测试文件 → 去重 7 天 → 入队 1-3 个 codex_test_gen 任务，07172225）' },
  { name: 'capture-aging', needsPool: true, timeoutMs: 30_000, handler: runCaptureAging, description: '账龄哨兵：超7天告警+llm_failed重试(≤3次)+超限转parked' },
  { name: 'acceptance-aging', needsPool: true, timeoutMs: 30_000, handler: runAcceptanceAging, description: '验收超时哨兵：pending/in_review超48h红灯Bark验收人+failed无驳回任务补偿扫描（1h自gate，主理人条件一，决策18174291）' },
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
  { name: 'notion-product-push', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: async (pool) => pushProductToNotionInbox(pool, {}), description: 'F5加厚 WS3 成品呈报：排序官归并产物（proposal/morning_summary/acceptance_receipt）→ Notion Inbox，5min自gate，幂等键notion:product:，回写tasks.notion_page_id（task:58e146e1）' },
  { name: 'notion-verdict-ingest', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: async (pool) => consumeVerdictFromNotion(pool, {}), description: 'F5加厚 WS3 裁决窄口：5min轮询Notion Inbox三字段白名单（放行/不放行/批注），放行→completed+decisions，不放行→cancelled，fail-closed（task:58e146e1）' },
];

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
  if (loopTimer) return loopTimer;
  // 供死人开关比对：预期 job 数写库，加 job 自动同步，哨兵脚本无需硬编码
  writeSentinelRaw(pool, 'scheduler_jobs_expected', { count: JOBS.length });
  loopTimer = setInterval(() => {
    // 重入守卫：一轮 job 最长可达 ~20min（4×5min timeout），慢 handler 会让
    // 60s tick 叠加并发调用同一 handler，踩中各模块自 gate 的先查后写(TOCTOU)竞态。
    if (running) return;
    running = true;
    runSchedulerJobsOnce(pool)
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
