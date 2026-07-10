/**
 * battle-report.js — 每日作战日报（relay-baton4 item3，骨架第一刀）
 *
 * 每日北京 06:00（UTC 22:00）窗口自动生成 L1 Summary 日报：
 *   ① 24h 合并 PR（dev_records；数据源自 2026-05-13 断供，段落恒空渲染"暂无"，接回留第二刀）
 *   ② 24h 按线 run 聚合（同 routes/harness.js ?by=journey 口径）
 *   ③ 24h 用户决策（decisions made_by='user'）
 *   ④ 哨兵摘要（同 routes/sentinel.js 口径：ok && age<=1800）
 *   ⑤ 军师决策（notes 表 line-strategist 落痕：type='Decision' + 标题前缀"军师决策["，按 Line 分组）
 * 落 design_docs(type='battle_report') + 飞书链接（best-effort，失败不回滚）。
 *
 * 调度：scheduler-jobs.js 60s 轮询 + 本模块自 gate（窗口 + 20h 去重），
 * 照 daily-backup-scheduler.js 先例。
 */
import { sendFeishu } from './notifier.js';

/** 每日触发小时（UTC）= 北京时间 06:00 */
const BATTLE_REPORT_HOUR_UTC = 22;

// 与 routes/sentinel.js 同口径（不 import，避免拖入 express 依赖链）
const SENTINEL_KEY_PREFIX = 'scheduler_job_last_run:';
const SENTINEL_EXPECTED_KEY = 'scheduler_jobs_expected';
const SENTINEL_STALE_SECONDS = 1800;

/**
 * 判断当前时间是否在日报触发窗口内（UTC 22:00-22:05 = 北京 06:00-06:05）。
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInBattleReportWindow(now = new Date()) {
  return now.getUTCHours() === BATTLE_REPORT_HOUR_UTC && now.getUTCMinutes() < 5;
}

/**
 * 当日去重：20h 内 design_docs 已有 battle_report → true。
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function alreadyGeneratedToday(pool) {
  const { rows } = await pool.query(
    `SELECT 1 FROM design_docs
     WHERE type = 'battle_report'
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * 采集 24h 窗口五段数据。
 * @param {import('pg').Pool} pool
 * @returns {Promise<{mergedPrs: Array, journeyRuns: Array, userDecisions: Array, strategistDecisions: Array, sentinel: object}>}
 */
export async function buildBattleReportData(pool) {
  // ① merged PR（dev_records 断供容忍：恒空则渲染"暂无"）
  const { rows: mergedPrs } = await pool.query(
    `SELECT pr_title, pr_url, merged_at
     FROM dev_records
     WHERE merged_at >= NOW() - interval '24 hours'
     ORDER BY merged_at DESC`
  );

  // ② 按线 run 聚合（抄 routes/harness.js ?by=journey，窗口改 24h）
  const { rows: runRows } = await pool.query(
    `SELECT j.id   AS journey_id,
            j.name AS journey_name,
            COUNT(*)                                     AS runs,
            COUNT(*) FILTER (WHERE ir.phase = 'done')    AS done,
            COUNT(*) FILTER (WHERE ir.phase = 'failed')  AS failed,
            MAX(ir.created_at)                           AS last_run_at,
            (ARRAY_AGG(ir.failure_reason ORDER BY ir.created_at DESC)
               FILTER (WHERE ir.failure_reason IS NOT NULL))[1] AS last_failure
     FROM initiative_runs ir
     JOIN journeys j ON j.id = ir.journey_id
     LEFT JOIN tasks t ON t.id = ir.initiative_id
     WHERE ir.created_at >= NOW() - interval '24 hours'
       AND ir.journey_id IS NOT NULL
       AND (t.title IS NULL OR t.title NOT ILIKE 'smoke-%')
     GROUP BY j.id, j.name
     ORDER BY runs DESC, last_run_at DESC NULLS LAST`
  );
  const journeyRuns = runRows.map((r) => {
    const done = parseInt(r.done, 10) || 0;
    const failed = parseInt(r.failed, 10) || 0;
    const terminal = done + failed;
    return {
      journey_id: r.journey_id,
      journey_name: r.journey_name,
      runs: parseInt(r.runs, 10) || 0,
      done,
      failed,
      success_rate: terminal > 0 ? Math.round((done / terminal) * 100) / 100 : 0,
      last_run_at: r.last_run_at,
      last_failure: r.last_failure || null,
    };
  });

  // ③ 用户决策
  const { rows: userDecisions } = await pool.query(
    `SELECT topic, created_at
     FROM decisions
     WHERE made_by = 'user'
       AND created_at >= NOW() - interval '24 hours'
     ORDER BY created_at DESC`
  );

  // ④ 哨兵摘要（同 routes/sentinel.js 口径）
  const { rows: sentinelRows } = await pool.query(
    `SELECT key, value_json, EXTRACT(EPOCH FROM (now() - updated_at))::int AS age_seconds
     FROM working_memory
     WHERE key LIKE $1 OR key = $2`,
    [`${SENTINEL_KEY_PREFIX}%`, SENTINEL_EXPECTED_KEY]
  );
  let expected = null;
  const jobs = [];
  for (const row of sentinelRows) {
    if (row.key === SENTINEL_EXPECTED_KEY) {
      const c = parseInt(row.value_json?.count, 10);
      expected = Number.isFinite(c) ? c : null;
      continue;
    }
    const v = row.value_json || {};
    jobs.push({
      name: row.key.slice(SENTINEL_KEY_PREFIX.length),
      ok: v.ok === true,
      age_seconds: row.age_seconds,
      at: v.at ?? null,
    });
  }
  const healthy =
    expected !== null &&
    jobs.length >= expected &&
    jobs.every((j) => j.ok && j.age_seconds <= SENTINEL_STALE_SECONDS);

  // ⑤ 军师决策（notes 表，line-strategist 落痕：type='Decision' + 标题前缀"军师决策["；
  //    照 warroom.js:404 先例 try/catch 降级——notes 表缺失/查询失败不拖垮整份日报）
  let strategistDecisions = [];
  try {
    const { rows } = await pool.query(
      `SELECT title, content, created_at
       FROM notes
       WHERE type = 'Decision'
         AND title LIKE '军师决策[%'
         AND created_at >= NOW() - interval '24 hours'
       ORDER BY created_at DESC
       LIMIT 50`
    );
    strategistDecisions = rows;
  } catch (err) {
    console.warn(`[battle-report] 军师决策查询失败（降级空）: ${err.message}`);
  }

  return { mergedPrs, journeyRuns, userDecisions, strategistDecisions, sentinel: { jobs, expected, healthy } };
}

/** 上海日 YYYY-MM-DD（sv-SE locale 即 ISO 格式） */
function shanghaiDay(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
}

/** 上海时间短格式 MM-DD HH:mm；null/非法输入返回空串 */
function formatShanghaiShort(date) {
  if (date == null) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * 渲染 L1 Summary 四段 markdown，空段渲染"暂无"。
 * @param {Awaited<ReturnType<typeof buildBattleReportData>>} data
 * @returns {string}
 */
export function renderBattleReportMarkdown(data) {
  const lines = [];

  lines.push('## 合并 PR（24h）');
  if (data.mergedPrs.length === 0) {
    lines.push('暂无');
  } else {
    for (const pr of data.mergedPrs) {
      lines.push(`- ${pr.pr_title ?? '(无标题)'}${pr.pr_url ? ` — ${pr.pr_url}` : ''}`);
    }
  }

  lines.push('');
  lines.push('## 各线战况（24h run 聚合）');
  if (data.journeyRuns.length === 0) {
    lines.push('暂无');
  } else {
    for (const j of data.journeyRuns) {
      const rate = `成功率 ${Math.round(j.success_rate * 100)}%`;
      const failure = j.last_failure ? `；最近卡点：${j.last_failure}` : '';
      lines.push(`- ${j.journey_name}：${j.runs} run（done ${j.done} / failed ${j.failed}，${rate}）${failure}`);
    }
  }

  lines.push('');
  lines.push('## 用户决策（24h）');
  if (data.userDecisions.length === 0) {
    lines.push('暂无');
  } else {
    for (const d of data.userDecisions) {
      lines.push(`- ${d.topic ?? '(无主题)'}（${formatShanghaiShort(d.created_at)}）`);
    }
  }

  lines.push('');
  lines.push('## 军师决策（24h）');
  const sd = data.strategistDecisions || [];
  if (sd.length === 0) {
    lines.push('暂无');
  } else {
    const byLine = new Map();
    for (const n of sd) {
      const m = /^军师决策\[([^\]]*)\]/.exec(n.title || '');
      const lineName = (m && m[1]) || '未知线';
      if (!byLine.has(lineName)) byLine.set(lineName, []);
      byLine.get(lineName).push(n);
    }
    for (const [lineName, items] of byLine) {
      lines.push(`### ${lineName}`);
      for (const n of items) {
        const summary = (n.title || '').replace(/^军师决策\[[^\]]*\]:?\s*/, '') || '(无标题)';
        lines.push(`- ${summary}（${formatShanghaiShort(n.created_at)}）`);
      }
    }
  }

  lines.push('');
  lines.push('## 哨兵摘要');
  const s = data.sentinel || { jobs: [], expected: null, healthy: false };
  lines.push(`整体：${s.healthy ? '✅ 健康' : '⚠️ 异常'}（预期 ${s.expected ?? '未知'} 个 job，实际 ${s.jobs.length} 个）`);
  if (s.jobs.length === 0) {
    lines.push('暂无');
  } else {
    for (const j of s.jobs) {
      const stale = j.age_seconds > SENTINEL_STALE_SECONDS ? '过期' : '正常';
      lines.push(`- ${j.name}：${j.ok ? 'ok' : 'fail'} / ${stale}（${j.age_seconds}s 前）`);
    }
  }

  return lines.join('\n');
}

/**
 * 生成日报：采集 → 渲染 → INSERT design_docs → 飞书链接（best-effort，失败不回滚）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<{id: string, url: string}>}
 */
export async function generateBattleReport(pool) {
  const data = await buildBattleReportData(pool);
  const content = renderBattleReportMarkdown(data);
  const day = shanghaiDay();
  const title = `作战日报 ${day}`;

  const { rows } = await pool.query(
    `INSERT INTO design_docs (type, title, content, area, author, diary_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    ['battle_report', title, content, 'cecelia', 'cecelia', day]
  );
  const id = rows[0].id;
  const url = `http://perfect21:5211/reports/${id}?source=design_docs`;

  try {
    await sendFeishu(`作战日报已生成：${url}`);
  } catch (err) {
    console.warn(`[battle-report] 飞书通知失败（不回滚）: ${err.message}`);
  }

  return { id, url };
}

/**
 * 每 60s 由 scheduler-jobs 调用：窗口 + 当日去重自 gate。
 * @param {import('pg').Pool} pool
 * @returns {Promise<{skipped: true, reason: string} | {id: string, url: string}>}
 */
export async function maybeGenerateBattleReport(pool) {
  if (!isInBattleReportWindow(new Date())) {
    return { skipped: true, reason: 'outside_window' };
  }
  if (await alreadyGeneratedToday(pool)) {
    return { skipped: true, reason: 'already_generated' };
  }
  return generateBattleReport(pool);
}
