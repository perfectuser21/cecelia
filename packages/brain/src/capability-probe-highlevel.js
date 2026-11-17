import pool from './db.js';
import { isConsciousnessEnabled } from './consciousness-guard.js';

// === 高层意识循环探针 ===

export async function probeRumination() {
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

  if (recentRuns > 0) {
    // rumination 在运行（有近 24h output 事件）→ 直接通过，不依赖 synthesis_archive 写入时效
    // synthesis_archive 写入是 non-blocking 异步路径，写入失败不代表 rumination 坏掉；
    // last_run 优先取 synthesis_archive 全局 max，fallback 到 output 事件时间（避免显示 'never'）
    return {
      ok: true,
      detail: `48h_count=0 last_run=${lastRun || lastEvent || 'never'} undigested=${undigested} (running: recent_outputs=${recentRuns} last_event=${lastEvent})`,
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

  // loop_dead 时：透出 consciousness 状态 + MINIMAL_MODE + 上次 tick 时间，帮助运维定位根因
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
  }

  return {
    ok: false,
    detail: `48h_count=0 last_run=${lastRun || lastEvent || 'never'} undigested=${undigested} recent_outputs=${recentRuns} heartbeats_24h=${recentHeartbeats} invocations_24h=${recentInvocations} (${livenessTag})${loopDeadContext}${llmFailureSummary}`,
  };
}

export async function probeEvolution() {
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

  if (cnt > 0) {
    return { ok: true, detail: `7d_pr_evolutions=${cnt} last_date=${lastDate}` };
  }

  // 无 7 天内记录 — 读取扫描状态判断是"空闲态"还是真实故障
  // 空闲态：扫描器 2 天内正常运行但近期无 PR 合并 → 非故障
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'evolution_last_scan_date' LIMIT 1`
    );
    const sd = rows[0]?.value_json;
    if (!sd) {
      return { ok: false, detail: `7d_pr_evolutions=0 last_date=never scan=never` };
    }
    if (sd.error) {
      return {
        ok: false,
        detail: `7d_pr_evolutions=0 last_date=${lastDate || 'never'} scan_error="${sd.error.slice(0, 80)}"`,
      };
    }
    const daysSinceScan = Math.floor((Date.now() - new Date(sd.date).getTime()) / 86400000);
    if (daysSinceScan <= 1) {
      // 扫描器 2 天内正常运行，无可写 PR → 空闲状态，非故障
      return {
        ok: true,
        detail: `7d_pr_evolutions=0 last_date=never last_scan=${sd.date} checked=${sd.checked ?? 0} (idle: no_merged_prs_in_window)`,
      };
    }
    // 扫描器超过 2 天未运行（consciousness 禁用或 tick 停止）
    return {
      ok: false,
      detail: `7d_pr_evolutions=0 last_date=${lastDate || 'never'} last_scan=${sd.date}(${daysSinceScan}d_ago) (scanner_stale)`,
    };
  } catch { /* non-fatal */ }

  return {
    ok: false,
    detail: `7d_pr_evolutions=0 last_date=${lastDate || 'never'} (scan_diag_unavailable)`,
  };
}

export async function probeConsolidation() {
  // 主路径：48h 内 memory_stream 是否有 daily_consolidation 记录
  const result = await pool.query(
    `SELECT count(*) AS cnt, max(created_at) AS last_run
     FROM memory_stream
     WHERE source_type = 'daily_consolidation'
       AND created_at > NOW() - INTERVAL '48 hours'`
  );
  const cnt = parseInt(result.rows[0]?.cnt || 0);
  const lastRun = result.rows[0]?.last_run;

  if (cnt > 0) {
    return {
      ok: true,
      detail: `48h_consolidations=${cnt} last_run=${lastRun || 'never'}`,
    };
  }

  // 兜底路径：memory_stream 为空，但 daily_logs 有近期 consolidation 记录
  // 适用场景：旧版 consolidation 在"空闲日"只写 daily_logs（修复前的历史数据）
  // 此时 consolidation 循环健康，只是 memory_stream 表存量未恢复，不应误报失败
  const logsResult = await pool.query(
    `SELECT count(*) AS cnt, max(date) AS last_date
     FROM daily_logs
     WHERE type = 'consolidation'
       AND date >= (NOW() - INTERVAL '48 hours')::date`
  );
  const logsCnt = parseInt(logsResult.rows[0]?.cnt || 0);
  const lastDate = logsResult.rows[0]?.last_date;

  if (logsCnt > 0) {
    return {
      ok: true,
      detail: `48h_consolidations=0 last_run=${lastRun || 'never'} daily_logs_48h=${logsCnt} last_date=${lastDate} (idle: empty_days_only)`,
    };
  }

  return {
    ok: false,
    detail: `48h_consolidations=0 last_run=${lastRun || 'never'} daily_logs_48h=0 (loop_dead)`,
  };
}
