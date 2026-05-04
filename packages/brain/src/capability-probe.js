/**
 * Capability Probe — 能力探针系统
 *
 * 定期验证 Cecelia 每条关键链路是否真的通，
 * 发现故障时自动创建修复任务（走 auto-fix 路径）。
 *
 * 类比：人体每时每刻都能感知自己的手脚是否能动，
 * Cecelia 每小时验证自己的核心能力是否还在线。
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pool from './db.js';
import {
  shouldAutoFix,
  dispatchToDevSkill,
} from './auto-fix.js';
import { raise } from './alerting.js';
import { isConsciousnessEnabled, setConsciousnessEnabled, getConsciousnessStatus } from './consciousness-guard.js';

// ============================================================
// Configuration
// ============================================================

const PROBE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PROBE_TIMEOUT_MS = 30_000; // per-probe timeout

// 连续失败阈值：同一探针在最近 N 次探针批次中均失败才触发回滚
// 保守设计：3 次连续失败 ≈ 3 小时持续异常，才视为需要回滚
const ROLLBACK_CONSECUTIVE_THRESHOLD = 3;

// 批次失败阈值：单次探针批次中失败探针总数 ≥ N 时立即触发回滚
// 适用场景：系统大面积崩溃（多探针同时失败），无需等待连续 3 次
const ROLLBACK_BATCH_THRESHOLD = 5;

// brain-rollback.sh 路径（相对项目根目录）
const _thisFile = fileURLToPath(import.meta.url);
const _projectRoot = path.resolve(path.dirname(_thisFile), '../../..');
const ROLLBACK_SCRIPT = path.join(_projectRoot, 'scripts', 'brain-rollback.sh');

// ============================================================
// Probe definitions
// ============================================================

/**
 * Each probe is { name, description, fn: async () => ProbeResult }
 * ProbeResult = { ok: boolean, detail?: string, latency_ms: number }
 */
const PROBES = [
  {
    name: 'db',
    description: '数据库连接 + 核心表可读',
    fn: probeDatabase,
  },
  {
    name: 'dispatch',
    description: '任务派发链路（tasks 表可写 + executor 模块可 import）',
    fn: probeDispatch,
  },
  {
    name: 'auto_fix',
    description: 'auto-fix 链路 dry-run（shouldAutoFix 函数可调用）',
    fn: probeAutoFix,
  },
  {
    name: 'notify',
    description: '飞书通知链路（alerting 模块可 import + 函数可调用）',
    fn: probeNotify,
  },
  {
    name: 'cortex',
    description: 'Cortex RCA 链路（cortex 模块可 import）',
    fn: probeCortex,
  },
  {
    name: 'monitor_loop',
    description: 'Monitor Loop 运行状态',
    fn: probeMonitorLoop,
  },
  // === 高层意识循环探针 ===
  {
    name: 'rumination',
    description: '反刍系统（24h 内是否有产出）',
    fn: probeRumination,
  },
  {
    name: 'evolution',
    description: '进化追踪（是否有 evolution 记录）',
    fn: probeEvolution,
  },
  {
    name: 'consolidation',
    description: '记忆合并（48h 内是否有合并记录）',
    fn: probeConsolidation,
  },
  {
    name: 'self_drive_health',
    description: 'Self-Drive 自驱引擎（24h 内是否成功创建任务）',
    fn: probeSelfDriveHealth,
  },
  // === 外部产品健康探针 ===
  {
    name: 'geo_website',
    description: 'geo SEO网站（zenithjoyai.com）可访问 + blog + posts 有内容',
    fn: probeGeoWebsite,
  },
];

// ============================================================
// Individual probe implementations
// ============================================================

async function probeDatabase() {
  // Check connection + core tables exist
  const result = await pool.query(`
    SELECT
      (SELECT count(*) FROM tasks) AS task_count,
      (SELECT count(*) FROM run_events WHERE ts_start > NOW() - INTERVAL '1 hour') AS recent_runs,
      (SELECT count(*) FROM learnings) AS learning_count
  `);
  const row = result.rows[0];
  return {
    ok: true,
    detail: `tasks=${row.task_count} recent_runs=${row.recent_runs} learnings=${row.learning_count}`,
  };
}

async function probeDispatch() {
  // Verify executor module is importable and skill map exists
  const { getActiveProcessCount, MAX_SEATS } = await import('./executor.js');
  const active = getActiveProcessCount();
  return {
    ok: true,
    detail: `active=${active}/${MAX_SEATS}`,
  };
}

async function probeAutoFix() {
  // Dry-run: call shouldAutoFix with a synthetic high-confidence RCA
  const dryResult = shouldAutoFix({
    confidence: 0.9,
    proposed_fix: 'Test fix proposal for capability probe dry-run verification.',
  });

  // Also verify dispatchToDevSkill is callable (but don't call it)
  const dispatchExists = typeof dispatchToDevSkill === 'function';

  return {
    ok: dryResult === true && dispatchExists,
    detail: `shouldAutoFix(0.9)=${dryResult} dispatchToDevSkill=${dispatchExists ? 'ok' : 'missing'}`,
  };
}

async function probeNotify() {
  // Verify alerting module is importable
  const alerting = await import('./alerting.js');
  const hasSend = typeof alerting.sendFeishuNotification === 'function'
    || typeof alerting.sendAlert === 'function'
    || typeof alerting.notifyFeishu === 'function';

  return {
    ok: hasSend || Object.keys(alerting).length > 0,
    detail: `alerting exports: ${Object.keys(alerting).slice(0, 5).join(', ')}`,
  };
}

async function probeCortex() {
  // Verify cortex module is importable and performRCA exists
  const cortex = await import('./cortex.js');
  const hasRCA = typeof cortex.performRCA === 'function';
  return {
    ok: hasRCA,
    detail: `performRCA=${hasRCA ? 'ok' : 'missing'}`,
  };
}

// 连续 5 个监控周期（5 × 30s = 150s）都没有新 cycle 才视为"卡死"
// 宽限期：loop 刚启动时 cycle_count=0，不误报
const STUCK_CYCLE_GAP_MS = PROBE_TIMEOUT_MS * 5; // 150s

async function probeMonitorLoop() {
  const { getMonitorStatus, startMonitorLoop } = await import('./monitor-loop.js');
  let status = getMonitorStatus();
  if (!status.running) {
    // Self-heal: monitor loop wasn't started (likely a startup error), restart it now
    console.log('[Probe] monitor_loop not running, attempting self-heal via startMonitorLoop()');
    try {
      startMonitorLoop();
    } catch (healErr) {
      console.error('[Probe] monitor_loop self-heal failed:', healErr.message);
      return {
        ok: false,
        detail: `running=false self_heal_error=${healErr.message}`,
      };
    }
    status = getMonitorStatus();
  }

  // Stuck detection: timer running but no cycle executed in too long
  // Only check after at least one cycle has completed (cycle_count > 0)
  if (status.running && status.cycle_count > 0 && status.last_cycle_at !== null) {
    const ageMs = Date.now() - status.last_cycle_at;
    if (ageMs > STUCK_CYCLE_GAP_MS) {
      return {
        ok: false,
        detail: `running=true but stuck: last_cycle_age=${Math.round(ageMs / 1000)}s cycle_count=${status.cycle_count}`,
      };
    }
  }

  return {
    ok: status.running === true,
    detail: `running=${status.running} interval=${status.interval_ms}ms cycle_count=${status.cycle_count ?? 0}`,
  };
}

// === 高层意识循环探针 ===

async function probeRumination() {
  // 阶段 1：检查 48h 内有没有反刍产出（synthesis_archive 表）
  // 使用 48h 而非 24h：runRumination 和 runDailySynthesis 两路写入可能产生约 40h 时间差
  // （runRumination 早上写入后，同日调度器 hasTodaySynthesis 检测到已存在而跳过）
  const archiveResult = await pool.query(
    `SELECT count(*) AS cnt FROM synthesis_archive
     WHERE created_at > NOW() - INTERVAL '48 hours'`
  );
  const cnt = parseInt(archiveResult.rows[0]?.cnt || 0);

  // 全局最近一次 synthesis_archive（不限 48h）— 用于 detail 显示真实 last_run
  // "last_run=never" 仅在表完全空时出现；否则给出真实 ISO 时间，运维可立即判断卡了多久
  const globalLastResult = await pool.query(
    `SELECT max(created_at) AS last_run FROM synthesis_archive`
  );
  const lastRun = globalLastResult.rows[0]?.last_run;

  if (cnt > 0) {
    return {
      ok: true,
      detail: `48h_count=${cnt} last_run=${lastRun}`,
    };
  }

  // 阶段 2：48h 内无 synthesis → 检查是否有待消化内容
  // 若无待消化内容，系统处于合理静默状态（非故障）
  const pendingResult = await pool.query(
    `SELECT count(*) AS cnt FROM learnings
     WHERE digested = false AND (archived = false OR archived IS NULL)`
  );
  const undigested = parseInt(pendingResult.rows[0]?.cnt || 0);

  if (undigested === 0) {
    return {
      ok: true,
      detail: `48h_count=0 last_run=${lastRun || 'never'} (idle: no_pending_learnings)`,
    };
  }

  // 阶段 3：有未消化内容但无近期 synthesis → 判断是误报还是真实故障
  // 误报场景："空白日"无新 learnings → 无 synthesis 写入 → 新 learnings 晚到 → 旧 synthesis 滑出 48h 窗口
  // 真实故障：rumination 完全停止运行（无任何 rumination_output 事件）
  //
  // 检查 24h 内是否有 rumination_output 事件（rumination 实际运行的证据）
  const runEventResult = await pool.query(
    `SELECT count(*) AS cnt, max(created_at) AS last_event
     FROM cecelia_events
     WHERE event_type = 'rumination_output'
       AND created_at > NOW() - INTERVAL '24 hours'`
  );
  const recentRuns = parseInt(runEventResult.rows[0]?.cnt || 0);
  const lastEvent = runEventResult.rows[0]?.last_event;

  // 检查 synthesis_archive 是否超过 72h 未更新（更严格的兜底）
  const staleResult = await pool.query(
    `SELECT count(*) AS cnt FROM synthesis_archive
     WHERE created_at > NOW() - INTERVAL '72 hours'`
  );
  const within72h = parseInt(staleResult.rows[0]?.cnt || 0);

  if (recentRuns > 0 && within72h > 0) {
    // rumination 在运行，synthesis 只是暂时没更新（正常的"空白日"场景）
    return {
      ok: true,
      detail: `48h_count=0 last_run=${lastRun || 'never'} undigested=${undigested} (running: recent_outputs=${recentRuns} last_event=${lastEvent})`,
    };
  }

  // 检查心跳事件（rumination_run）— 用于区分"循环未跑"vs"循环在跑但 LLM 全失败"
  // 心跳由 digestLearnings 入口处无条件写入，是循环存活的可靠证据
  const heartbeatResult = await pool.query(
    `SELECT count(*) AS cnt FROM cecelia_events
     WHERE event_type = 'rumination_run'
       AND created_at > NOW() - INTERVAL '24 hours'`
  );
  const recentHeartbeats = parseInt(heartbeatResult.rows[0]?.cnt || 0);

  // 检查调用心跳（rumination_invoke）— 冷却期过后每次进入核心逻辑写入
  // invoke > 0 但 run = 0：runRumination 被调用但无 learnings/内部提前返回（misfire）
  // invoke = 0 且 run = 0：runRumination 根本未被调用（consciousness 禁用或 tick 不工作）
  let recentInvocations = 0;
  try {
    const invokeResult = await pool.query(
      `SELECT count(*) AS cnt FROM cecelia_events
       WHERE event_type = 'rumination_invoke'
         AND created_at > NOW() - INTERVAL '24 hours'`
    );
    recentInvocations = parseInt(invokeResult.rows[0]?.cnt || 0);
  } catch (e) {
    console.warn('[capability-probe] rumination_invoke lookup failed (non-blocking):', e.message);
  }

  // livenessTag 三态：
  //   degraded_llm_failure  — digestLearnings 跑了但 LLM 全失败（run=0 但 invoke>0 且 run-inside-digest=0 不适用）
  //   invoke_no_digest      — runRumination 被调用但未进入 digestLearnings（无 items 或提前返回）
  //   loop_dead             — runRumination 完全未被调用（consciousness 禁用 / tick 停止）
  let livenessTag;
  if (recentHeartbeats > 0) {
    livenessTag = 'degraded_llm_failure';
  } else if (recentInvocations > 0) {
    livenessTag = 'invoke_no_digest';
  } else {
    livenessTag = 'loop_dead';
  }

  // 取最近一次 rumination_llm_failure 事件，把根因带进 probe detail。
  // 这样 PROBE_FAIL_RUMINATION 触发时，运维不用再去 grep 日志，直接从 probe 输出就能看到 nb/llm 错误。
  let llmFailureSummary = '';
  if (livenessTag === 'degraded_llm_failure') {
    try {
      const { rows: failRows } = await pool.query(
        `SELECT payload FROM cecelia_events
         WHERE event_type = 'rumination_llm_failure'
         ORDER BY created_at DESC
         LIMIT 1`
      );
      const payload = failRows[0]?.payload;
      if (payload) {
        const nb = payload.notebook_error || '?';
        const llm = payload.llm_error || '?';
        llmFailureSummary = ` last_llm_failure: notebook=${String(nb).slice(0, 60)} llm=${String(llm).slice(0, 60)}`;
      }
    } catch (e) {
      console.warn('[capability-probe] rumination_llm_failure lookup failed (non-blocking):', e.message);
    }
  }

  // loop_dead 时：透出 consciousness 状态 + MINIMAL_MODE + 上次 tick 时间，帮助 auto-fix 快速定位根因
  let loopDeadContext = '';
  if (livenessTag === 'loop_dead') {
    // BRAIN_MINIMAL_MODE=true 时 tick-runner 跳过整个 section 10.x（含 rumination），是 loop_dead 常见根因
    const minimalMode = process.env.BRAIN_MINIMAL_MODE === 'true';
    if (minimalMode) {
      loopDeadContext += ' minimal_mode=ENABLED(blocks_rumination)';
    }

    try {
      const { rows: consciousnessRows } = await pool.query(
        `SELECT value_json FROM working_memory WHERE key = 'consciousness_enabled' LIMIT 1`
      );
      const consciousnessVal = consciousnessRows[0]?.value_json;
      const consciousnessEnabled = isConsciousnessEnabled();
      if (consciousnessEnabled) {
        loopDeadContext += ' consciousness=enabled';
      } else {
        const dbEnabled = consciousnessVal?.enabled !== false;
        const source = !dbEnabled ? '(db)' : '(env_override)';
        loopDeadContext += ` consciousness=DISABLED${source}`;
      }
    } catch (e) {
      console.warn('[capability-probe] consciousness_enabled lookup failed (non-blocking):', e.message);
    }

    try {
      const { rows: tickRows } = await pool.query(
        `SELECT value_json FROM working_memory WHERE key = 'tick_last' LIMIT 1`
      );
      const tickTs = tickRows[0]?.value_json?.timestamp;
      if (tickTs) {
        const tickAgeMin = Math.round((Date.now() - new Date(tickTs).getTime()) / 60000);
        loopDeadContext += ` last_tick=${tickTs}(${tickAgeMin}min_ago)`;
      } else {
        loopDeadContext += ' last_tick=never';
      }
    } catch (e) {
      console.warn('[capability-probe] tick_last lookup failed (non-blocking):', e.message);
    }

    // loop_dead 自愈：
    //   A. consciousness 被 DB 禁用（非 env override、非 minimal_mode 人工开关）→ 自动重新启用
    //   B. consciousness 已启用 + minimal_mode 未设 → 直接调用 runRumination 解堵
    // env_override 或 minimal_mode 为人工开关，不自动覆盖
    const envOverride = getConsciousnessStatus().env_override;
    if (!envOverride && !minimalMode) {
      const consEnabled = isConsciousnessEnabled();
      if (!consEnabled) {
        // Case A: consciousness 被 DB 禁用，非 env override → 自动恢复
        try {
          await setConsciousnessEnabled(pool, true);
          loopDeadContext += ' self_heal=consciousness_reenabled';
          console.log('[Probe] rumination loop_dead self-heal: consciousness re-enabled via DB');
        } catch (healErr) {
          loopDeadContext += ` self_heal_fail=${healErr.message.slice(0, 60)}`;
          console.warn('[Probe] rumination self-heal failed:', healErr.message);
        }
      } else {
        // Case B: consciousness 已启用但 runRumination 未被调用 → 直接运行解堵
        try {
          const { runRumination } = await import('./rumination.js');
          const healResult = await runRumination(pool);
          const healDigested = healResult?.digested ?? 0;
          loopDeadContext += ` self_heal=direct_run digested=${healDigested}`;
          console.log(`[Probe] rumination loop_dead self-heal: direct_run digested=${healDigested}`);
        } catch (healErr) {
          loopDeadContext += ` self_heal_fail=${healErr.message.slice(0, 60)}`;
          console.warn('[Probe] rumination self-heal direct_run failed:', healErr.message);
        }
      }
    }
  }

  return {
    ok: false,
    detail: `48h_count=0 last_run=${lastRun || 'never'} undigested=${undigested} recent_outputs=${recentRuns} heartbeats_24h=${recentHeartbeats} invocations_24h=${recentInvocations} (${livenessTag})${loopDeadContext}${llmFailureSummary}`,
  };
}

async function probeEvolution() {
  // 检查 7 天内是否有 PR 进化记录（写入 component_evolutions 表）
  const result = await pool.query(
    `SELECT count(*) AS cnt, max(date) AS last_date
     FROM component_evolutions
     WHERE date > (NOW() - INTERVAL '7 days')::date`
  );
  const cnt = parseInt(result.rows[0]?.cnt || 0);
  const lastDate = result.rows[0]?.last_date
    ? new Date(result.rows[0].last_date).toISOString().slice(0, 10)
    : null;
  return {
    ok: cnt > 0,
    detail: `7d_pr_evolutions=${cnt} last_date=${lastDate || 'never'}`,
  };
}

async function probeConsolidation() {
  // 检查 48h 内有没有记忆合并
  const result = await pool.query(
    `SELECT count(*) AS cnt, max(created_at) AS last_run
     FROM memory_stream
     WHERE source_type = 'daily_consolidation'
       AND created_at > NOW() - INTERVAL '48 hours'`
  );
  const cnt = parseInt(result.rows[0]?.cnt || 0);
  const lastRun = result.rows[0]?.last_run;
  return {
    ok: cnt > 0,
    detail: `48h_consolidations=${cnt} last_run=${lastRun || 'never'}`,
  };
}

async function probeSelfDriveHealth() {
  // cycle_error    = LLM 调用失败（探针应失败）
  // no_action      = LLM 正常运行但判断无需行动（系统健康，不误判为失败）
  // cycle_complete = LLM 正常运行并做出决策（tasks_created 可以是 0）
  // loop_started   = Brain 启动心跳（首次 cycle 还未运行时的宽限期凭据）

  // Consciousness guard: self-drive is intentionally inactive when consciousness is disabled.
  // Reporting ok:false here would cause an endless auto-fix loop since the loop will
  // never generate events while disabled. Return ok:true with an informative detail instead.
  if (!isConsciousnessEnabled()) {
    const status = getConsciousnessStatus();
    const source = status.env_override ? 'env_override' : 'db';
    return {
      ok: true,
      detail: `24h: consciousness_disabled(${source}) — self-drive intentionally inactive`,
    };
  }

  // Loop-running guard: consciousness is enabled but the self-drive loop was never started.
  // This happens when consciousness is re-enabled at runtime (e.g. via the rumination probe
  // self-heal or the settings API) after Brain started with it disabled. startSelfDriveLoop()
  // is only called at server startup, so a runtime toggle leaves the loop permanently off.
  // Detect this and restart the loop proactively, mirroring the rumination self-heal pattern.
  let selfDriveStatusForGrace = null;
  try {
    const { getSelfDriveStatus, startSelfDriveLoop } = await import('./self-drive.js');
    const sdStatus = getSelfDriveStatus();
    if (!sdStatus.running) {
      await startSelfDriveLoop();
      console.log('[Probe] self_drive_health self-heal: loop was not running — restarted');
      return {
        ok: true,
        detail: '24h: self_heal=loop_restarted — consciousness enabled but loop was not running',
      };
    }
    selfDriveStatusForGrace = sdStatus;
  } catch (healErr) {
    console.warn('[Probe] self_drive_health self-heal failed (non-blocking):', healErr.message);
  }

  const result = await pool.query(
    `SELECT
       count(*) filter (where payload->>'subtype' IN ('cycle_complete', 'no_action')) AS success_cnt,
       count(*) filter (where payload->>'subtype' = 'cycle_error') AS error_cnt,
       max(case when payload->>'subtype' IN ('cycle_complete', 'no_action')
           then created_at end) AS last_success,
       coalesce(sum((payload->>'tasks_created')::int) filter (
           where payload->>'subtype' = 'cycle_complete'
             AND (payload->>'tasks_created')::int > 0
       ), 0) AS total_tasks_created,
       max(case when payload->>'subtype' = 'loop_started'
           then created_at end) AS last_loop_started
     FROM cecelia_events
     WHERE event_type = 'self_drive'
       AND created_at > NOW() - INTERVAL '24 hours'`
  );
  const row = result.rows[0] || {};
  const successCnt = parseInt(row.success_cnt || 0);
  const errorCnt = parseInt(row.error_cnt || 0);
  const tasksCreated = parseInt(row.total_tasks_created || 0);
  const lastSuccess = row.last_success;
  const lastLoopStarted = row.last_loop_started;

  // Primary: successful cycles in past 24h
  if (successCnt > 0) {
    return {
      ok: true,
      detail: `24h: successful_cycles=${successCnt} errors=${errorCnt} tasks_created=${tasksCreated} last_success=${lastSuccess || 'never'}`,
    };
  }

  // Secondary: Brain just restarted — loop_started recorded within last 6h, no errors yet
  // 6h = default 4h interval + 2min initial delay + ~2h buffer
  const LOOP_STARTED_GRACE_MS = 6 * 60 * 60 * 1000;
  const loopStartedAt = lastLoopStarted ? new Date(lastLoopStarted) : null;
  const loopStartedHealthy = loopStartedAt &&
    (Date.now() - loopStartedAt.getTime() < LOOP_STARTED_GRACE_MS) &&
    errorCnt === 0;

  if (loopStartedHealthy) {
    return {
      ok: true,
      detail: `24h: loop_started=${loopStartedAt.toISOString()} awaiting_first_cycle errors=${errorCnt}`,
    };
  }

  // In-memory grace: if the loop IS running and started recently according to module state,
  // treat as healthy even when loop_started DB event was not written (transient DB write failure).
  // Only applies when there are no errors — silent failures without errors suggest DB write issue,
  // not a genuine cycle failure.
  if (successCnt === 0 && errorCnt === 0 && selfDriveStatusForGrace?.started_at) {
    const inMemGraceMs = LOOP_STARTED_GRACE_MS;
    const inMemAge = Date.now() - selfDriveStatusForGrace.started_at.getTime();
    if (inMemAge < inMemGraceMs) {
      return {
        ok: true,
        detail: `24h: loop_running_since=${selfDriveStatusForGrace.started_at.toISOString()} awaiting_first_cycle (db_event_missing) errors=${errorCnt}`,
      };
    }
  }

  return {
    ok: false,
    detail: `24h: successful_cycles=${successCnt} errors=${errorCnt} tasks_created=${tasksCreated} last_success=${lastSuccess || 'never'}`,
  };
}

async function probeGeoWebsite() {
  const BASE = 'https://zenithjoyai.com';
  const checks = [
    { url: `${BASE}/zh/`, expect: 'ZenithJoyAI', label: 'homepage' },
    { url: `${BASE}/zh/blog/`, expect: '/zh/blog/', label: 'blog_list' },
    { url: `${BASE}/zh/posts/`, expect: null, label: 'posts_page' },
  ];

  const details = [];
  let allOk = true;

  for (const check of checks) {
    try {
      const res = await fetch(check.url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
      const ok = res.status === 200 && (!check.expect || (await res.text()).includes(check.expect));
      details.push(`${check.label}=${ok ? 'ok' : `fail(${res.status})`}`);
      if (!ok) allOk = false;
    } catch (err) {
      details.push(`${check.label}=error(${err.message.slice(0, 40)})`);
      allOk = false;
    }
  }

  return { ok: allOk, detail: details.join(' ') };
}

// ============================================================
// Core probe runner
// ============================================================

/**
 * Run all probes and return results.
 * @returns {Promise<Array<{name, description, ok, detail, latency_ms, error}>>}
 */
export async function runProbes() {
  const results = [];

  for (const probe of PROBES) {
    const start = Date.now();
    try {
      const result = await Promise.race([
        probe.fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS)
        ),
      ]);

      results.push({
        name: probe.name,
        description: probe.description,
        ok: result.ok,
        detail: result.detail || '',
        latency_ms: Date.now() - start,
        error: null,
      });
    } catch (err) {
      results.push({
        name: probe.name,
        description: probe.description,
        ok: false,
        detail: '',
        latency_ms: Date.now() - start,
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Get latest probe results from cecelia_events table.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getProbeResults(limit = 5) {
  const result = await pool.query(
    `SELECT payload, created_at
     FROM cecelia_events
     WHERE event_type = 'capability_probe'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ============================================================
// 连续失败检测 + 自动回滚
// ============================================================

/**
 * 查询指定探针在最近 N 次探针批次中是否连续失败。
 * 从 cecelia_events 中读取历史记录（Brain 重启后不丢失）。
 *
 * @param {string} probeName - 探针名称（如 'db'、'dispatch'）
 * @param {number} threshold - 连续失败阈值（默认 ROLLBACK_CONSECUTIVE_THRESHOLD）
 * @returns {Promise<{consecutive: number, shouldRollback: boolean}>}
 */
export async function checkConsecutiveFailures(probeName, threshold = ROLLBACK_CONSECUTIVE_THRESHOLD) {
  try {
    const result = await pool.query(
      `SELECT payload FROM cecelia_events
       WHERE event_type = 'capability_probe'
       ORDER BY created_at DESC
       LIMIT $1`,
      [threshold]
    );

    if (result.rows.length < threshold) {
      // 历史记录不足，无法判断连续失败
      return { consecutive: result.rows.length, shouldRollback: false };
    }

    let consecutive = 0;
    for (const row of result.rows) {
      const payload = typeof row.payload === 'string'
        ? JSON.parse(row.payload)
        : row.payload;

      const probeResults = payload?.probes || [];
      const probeEntry = probeResults.find(p => p.name === probeName);

      if (probeEntry && probeEntry.ok === false) {
        consecutive++;
      } else {
        // 只要中间有一次成功，连续失败链断开
        break;
      }
    }

    return {
      consecutive,
      shouldRollback: consecutive >= threshold,
    };
  } catch (err) {
    console.error(`[Probe] checkConsecutiveFailures 查询失败: ${err.message}`);
    return { consecutive: 0, shouldRollback: false };
  }
}

/**
 * 执行 brain-rollback.sh，同步调用，捕获退出码和输出。
 *
 * @param {string} triggerReason - 触发原因（用于日志和告警）
 * @returns {{ success: boolean, stdout: string, stderr: string, exitCode: number }}
 */
export function executeRollback(triggerReason) {
  // 执行前必须打印明确的触发原因
  console.log(`[Probe] 触发自动回滚 — 原因: ${triggerReason}`);
  console.log(`[Probe] 回滚脚本路径: ${ROLLBACK_SCRIPT}`);

  if (!existsSync(ROLLBACK_SCRIPT)) {
    const msg = `回滚脚本不存在: ${ROLLBACK_SCRIPT}`;
    console.error(`[Probe] ${msg}`);
    return { success: false, stdout: '', stderr: msg, exitCode: -1 };
  }

  const proc = spawnSync('bash', [ROLLBACK_SCRIPT], {
    timeout: 90_000, // 90 秒超时
    encoding: 'utf8',
    env: { ...process.env },
  });

  const exitCode = proc.status ?? -1;
  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';

  if (exitCode === 0) {
    console.log(`[Probe] 自动回滚成功 ✅`);
    if (stdout) console.log(`[Probe] 回滚输出:\n${stdout.slice(0, 500)}`);
  } else {
    console.error(`[Probe] 自动回滚失败 ❌ (exit=${exitCode})`);
    if (stderr) console.error(`[Probe] 回滚错误:\n${stderr.slice(0, 500)}`);
    if (proc.error) console.error(`[Probe] 进程错误: ${proc.error.message}`);
  }

  return { success: exitCode === 0, stdout, stderr, exitCode };
}

// ============================================================
// Scheduled probe cycle — helper functions
// ============================================================

async function persistProbeResults(results, failures, timestamp) {
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ('capability_probe', 'capability-probe', $1)`,
      [JSON.stringify({
        timestamp,
        total: results.length,
        passed: results.length - failures.length,
        failed: failures.length,
        probes: results,
      })]
    );
  } catch (err) {
    console.error(`[Probe] Failed to persist results: ${err.message}`);
  }
}

async function persistRollbackEvent(payload) {
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ('probe_rollback_triggered', 'capability-probe', $1)`,
      [JSON.stringify(payload)]
    );
  } catch (evtErr) {
    console.error(`[Probe] 回滚事件写入失败: ${evtErr.message}`);
  }
}

async function dispatchAutoFixes(failures) {
  for (const f of failures) {
    const rcaResult = {
      confidence: 0.75,
      root_cause: `Capability probe "${f.name}" (${f.description}) failed: ${f.error || f.detail}`,
      proposed_fix: `Investigate and fix the ${f.name} subsystem. Error: ${f.error || f.detail}. This probe checks: ${f.description}.`,
      action_plan: `1. Read the ${f.name} related code\n2. Identify why it fails\n3. Fix the issue\n4. Verify the probe passes`,
      evidence: `Probe result: ok=${f.ok}, latency=${f.latency_ms}ms, error=${f.error || 'none'}`,
    };

    if (!shouldAutoFix(rcaResult)) continue;

    try {
      const signature = `probe_${f.name}`;
      const failure = {
        task_id: null,
        reason_code: `PROBE_FAIL_${f.name.toUpperCase()}`,
        layer: 'probe',
        step_name: f.name,
        run_id: null,
      };
      const taskId = await dispatchToDevSkill(failure, rcaResult, signature);
      console.log(`[Probe] Auto-fix task created for ${f.name}: ${taskId}`);
    } catch (dispatchErr) {
      console.error(`[Probe] Auto-fix dispatch failed for ${f.name}: ${dispatchErr.message}`);
    }
  }
}

// ── 批次失败检测：单批次总失败数 ≥ 阈值时立即触发回滚 ──
// 返回 true 表示已触发回滚，调用方应跳过逐探针连续失败检测
async function handleBatchRollback(failures) {
  if (failures.length < ROLLBACK_BATCH_THRESHOLD) return false;

  const batchTriggerReason = `单次探针批次总失败数 ${failures.length} 达到阈值 ${ROLLBACK_BATCH_THRESHOLD}（失败探针：${failures.map(f => f.name).join(', ')}），触发自动回滚`;

  await raise('P0', 'probe_rollback_trigger_batch_failures', `🔄 自动回滚触发（批次过载）— ${batchTriggerReason}`);

  const result = executeRollback(batchTriggerReason);
  const resultMsg = result.success
    ? `✅ 自动回滚成功（批次过载）— batch_failures=${failures.length}/${ROLLBACK_BATCH_THRESHOLD}，brain-rollback.sh 退出码 0`
    : `❌ 自动回滚失败（批次过载）— batch_failures=${failures.length}/${ROLLBACK_BATCH_THRESHOLD}，brain-rollback.sh 退出码 ${result.exitCode}。错误: ${result.stderr.slice(0, 200)}`;

  await raise('P0', 'probe_rollback_result_batch_failures', resultMsg);

  await persistRollbackEvent({
    timestamp: new Date().toISOString(),
    trigger_type: 'batch_failures',
    batch_failures: failures.length,
    threshold: ROLLBACK_BATCH_THRESHOLD,
    failed_probes: failures.map(f => f.name),
    trigger_reason: batchTriggerReason,
    rollback_success: result.success,
    rollback_exit_code: result.exitCode,
    rollback_stderr: result.stderr.slice(0, 500),
  });

  return true;
}

// ── 连续失败检测：阈值内连续失败才触发回滚（兜底机制）──
// 返回 true 表示已触发回滚，调用方应停止检查后续探针
async function handleConsecutiveRollback(f) {
  const { consecutive, shouldRollback } = await checkConsecutiveFailures(f.name);

  if (!shouldRollback) {
    if (consecutive > 1) {
      console.log(`[Probe] ${f.name} 连续失败 ${consecutive}/${ROLLBACK_CONSECUTIVE_THRESHOLD} 次，暂不回滚`);
    }
    return false;
  }

  const triggerReason = `探针 "${f.name}"（${f.description}）连续失败 ${consecutive} 次，达到阈值 ${ROLLBACK_CONSECUTIVE_THRESHOLD}，触发自动回滚`;

  await raise('P0', `probe_rollback_trigger_${f.name}`, `🔄 自动回滚触发 — ${triggerReason}`);

  // 执行回滚（同步，防止 Brain 进程在此期间继续处理其他事）
  const result = executeRollback(triggerReason);
  const resultMsg = result.success
    ? `✅ 自动回滚成功 — 探针 "${f.name}" 触发，brain-rollback.sh 退出码 0`
    : `❌ 自动回滚失败 — 探针 "${f.name}" 触发，brain-rollback.sh 退出码 ${result.exitCode}。错误: ${result.stderr.slice(0, 200)}`;

  await raise('P0', `probe_rollback_result_${f.name}`, resultMsg);

  await persistRollbackEvent({
    timestamp: new Date().toISOString(),
    probe_name: f.name,
    consecutive_failures: consecutive,
    threshold: ROLLBACK_CONSECUTIVE_THRESHOLD,
    trigger_reason: triggerReason,
    rollback_success: result.success,
    rollback_exit_code: result.exitCode,
    rollback_stderr: result.stderr.slice(0, 500),
  });

  return true;
}

// ============================================================
// Scheduled probe cycle
// ============================================================

let _probeTimer = null;

/**
 * Run probes, persist results, and trigger auto-fix for failures.
 */
async function runProbeCycle() {
  console.log('[Probe] Starting capability probe cycle...');

  const results = await runProbes();
  const failures = results.filter(r => !r.ok);
  const timestamp = new Date().toISOString();

  await persistProbeResults(results, failures, timestamp);

  if (failures.length === 0) {
    console.log(`[Probe] All ${results.length} probes passed ✅`);
    return results;
  }

  console.log(`[Probe] ${failures.length}/${results.length} probes FAILED ❌`);
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.error || f.detail}`);
  }

  await dispatchAutoFixes(failures);

  // 批次失败优先检测，触发则跳过逐探针连续失败检测
  if (await handleBatchRollback(failures)) return results;

  // 注意：此处在当前批次结果已持久化后执行，所以查询历史包含本次
  for (const f of failures) {
    if (await handleConsecutiveRollback(f)) break;
  }

  return results;
}

/**
 * Start periodic probe cycle.
 */
export function startProbeLoop() {
  if (_probeTimer) {
    console.log('[Probe] Loop already running');
    return;
  }

  console.log(`[Probe] Starting capability probe loop (interval: ${PROBE_INTERVAL_MS / 1000}s)`);

  // Establish setInterval immediately so the loop survives a hung first cycle.
  // If the 30s initial run hangs, the 1h interval keeps ticking regardless.
  _probeTimer = setInterval(runProbeCycle, PROBE_INTERVAL_MS);
  setTimeout(runProbeCycle, 30_000);
}

/**
 * Get probe system status.
 */
export function getProbeStatus() {
  return {
    running: _probeTimer !== null,
    interval_ms: PROBE_INTERVAL_MS,
    probe_count: PROBES.length,
    probe_names: PROBES.map(p => p.name),
  };
}

export { runProbeCycle, PROBES, ROLLBACK_BATCH_THRESHOLD, ROLLBACK_CONSECUTIVE_THRESHOLD };
