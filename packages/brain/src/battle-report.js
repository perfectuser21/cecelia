/**
 * battle-report.js — 每日作战日报（relay-baton4 item3，骨架第一刀）
 *
 * 每日北京 06:00（UTC 22:00）窗口自动生成 L1 Summary 日报：
 *   ① 24h 合并 PR（dev_records；数据源自 2026-05-13 断供，段落恒空渲染"暂无"，接回留第二刀）
 *   ② 24h 按线 run 聚合（同 routes/harness.js ?by=journey 口径）
 *   ③ 24h 用户决策（decisions made_by='user'）
 *   ④ 哨兵摘要（同 routes/sentinel.js 口径：ok && age<=1800）
 *   ⑤ 军师决策节 v2 五段（GP 批审桌）
 *   ⑥ 未确认动作（action_receipts 24h 内 pending/timeout/failed，T4 回执台账）
 * 落 design_docs(type='battle_report') + 飞书链接（best-effort，失败不回滚）。
 *
 * 调度：scheduler-jobs.js 60s 轮询 + 本模块自 gate（窗口 + 20h 去重），
 * 照 daily-backup-scheduler.js 先例。
 */
import { sendFeishu } from './notifier.js';
import { getUnconfirmedReceipts } from './receipt-collector.js';

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
 * 采集 24h 窗口六段数据。
 * @param {import('pg').Pool} pool
 * @param {Date} [now] 当前时间（军师节 v2 周一判断用，可注入测试）
 * @returns {Promise<{mergedPrs: Array, journeyRuns: Array, userDecisions: Array, sentinel: object, unconfirmedActions: Array, goldenPathMode: object|null}>}
 */
export async function buildBattleReportData(pool, now = new Date()) {
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

  // ⑥ 未确认动作（action_receipts，T4；try/catch 降级——查询失败不拖垮整份日报）
  let unconfirmedActions = [];
  try {
    unconfirmedActions = await getUnconfirmedReceipts(pool);
  } catch (err) {
    console.warn(`[battle-report] 未确认动作查询失败（降级空）: ${err.message}`);
  }

  // ⑤ 军师节 v2 · GP 批审桌取数（golden_paths + gp_gap_panorama + [自动派工] 台账；取数放⑥后不影响段序；
  //    整块降级 null——golden_paths 表缺失/查询失败不拖垮整份日报）
  let goldenPathMode = null;
  try {
    const { rows: candidates } = await pool.query(
      `SELECT id, title, one_liner, est_scale, kr_id
       FROM golden_paths WHERE status = 'candidate' ORDER BY created_at ASC`
    );
    const { rows: convergedRows } = await pool.query(
      `SELECT id, title, demo_url, proposal_doc
       FROM golden_paths WHERE status = 'converged' ORDER BY created_at ASC`
    );
    const converged = convergedRows.map((g) => ({
      id: g.id, title: g.title, demo_url: g.demo_url,
      has_novel: hasNovelJudgment(g.proposal_doc),
    }));
    const { rows: autoReleases } = await pool.query(
      `SELECT id, title, veto_deadline, demo_url
       FROM golden_paths
       WHERE auto_release = TRUE AND veto_deadline IS NOT NULL AND veto_deadline > NOW()
         AND status NOT IN ('rejected','superseded')
       ORDER BY veto_deadline ASC`
    );
    const { rows: priorReleased } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM golden_paths
       WHERE auto_release = TRUE AND approved_at IS NOT NULL`
    );
    const { rows: stock } = await pool.query(
      `SELECT status, COUNT(*)::int AS count,
              (ARRAY_AGG(status_reason ORDER BY updated_at DESC)
                 FILTER (WHERE status_reason IS NOT NULL))[1] AS latest_reason
       FROM golden_paths GROUP BY status ORDER BY status`
    );
    const { rows: gapRows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`, ['gp_gap_panorama']
    );
    const { rows: dispatchLedger } = await pool.query(
      `SELECT title, status, created_at FROM tasks
       WHERE title LIKE '[自动派工]%' AND created_at >= NOW() - interval '24 hours'
       ORDER BY created_at DESC`
    );
    goldenPathMode = {
      isMonday: isShanghaiMonday(now),
      candidates, converged, autoReleases,
      firstRelease: (parseInt(priorReleased[0]?.n, 10) || 0) === 0 && autoReleases.length > 0,
      stock, dispatchLedger,
      gapPanorama: gapRows[0]?.value_json ?? null,
    };
  } catch (err) {
    console.warn(`[battle-report] 军师节 v2 取数失败（降级 null）: ${err.message}`);
  }

  return { mergedPrs, journeyRuns, userDecisions, sentinel: { jobs, expected, healthy }, unconfirmedActions, goldenPathMode };
}

/** 上海时区是否周一 */
function isShanghaiMonday(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(now) === 'Mon';
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

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * 判定 GP 提案是否含新型判定点（批审段排序用，设计文档实现级决策1）。
 * DB 无结构化列，从 proposal_doc 的「判定点登记表」markdown 表格解析：
 * 存在既无先例 decision uuid 又无「先例」字样的登记行 → 新型。
 * 文档缺失/无登记表 → 保守返回 true（排前重点看）。
 * @param {string|null} proposalDoc
 * @returns {boolean}
 */
export function hasNovelJudgment(proposalDoc) {
  if (!proposalDoc) return true;
  const lines = proposalDoc.split('\n');
  const start = lines.findIndex((l) => l.includes('判定点登记表'));
  if (start === -1) return true;
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#/.test(l)) break;
    if (!l.startsWith('|')) continue;
    if (/^\|[\s\-:|]+\|$/.test(l)) continue;           // 分隔行
    if (/判定点/.test(l) && /候选/.test(l)) continue;   // 表头行
    rows.push(l);
  }
  if (rows.length === 0) return true;
  if (rows.every((r) => /N\/A|无接缝/.test(r))) return false;
  return rows.some((r) => !UUID_RE.test(r) && !r.includes('先例'));
}

/** 需 Alex 动作条目硬上限（规格 v2 解法⑤） */
const MAX_ALEX_ACTIONS = 7;

/**
 * 汇总需 Alex 动作条目并按优先级排序（新型判定点 > 首次放行 > 全先例批审折叠 > 圈选；
 * 抽检=优先级4，棘轮范围外本期恒空。报备段否决窗条目属被动知情不在此列）。
 */
function buildGpActionItems(gp) {
  const items = [];
  for (const g of gp.converged.filter((x) => x.has_novel)) {
    items.push({ priority: 1, segment: 'review', text: `【批审·新型判定点】${g.title}${g.demo_url ? ` — ${g.demo_url}` : ''}` });
  }
  if (gp.firstRelease) {
    for (const r of gp.autoReleases) {
      items.push({ priority: 2, segment: 'release', releaseId: r.id, text: `【首次放行】${r.title}（否决窗至 ${formatShanghaiShort(r.veto_deadline)}）` });
    }
  }
  const precedent = gp.converged.filter((x) => !x.has_novel);
  if (precedent.length > 0) {
    items.push({ priority: 2.5, segment: 'review', text: `【批审·全先例】${precedent.map((x) => x.title).join('、')}（${precedent.length} 条快速过）` });
  }
  if (gp.isMonday) {
    gp.candidates.forEach((c, i) => {
      items.push({ priority: 3, segment: 'selection', text: `【圈选 ${i + 1}】${c.title} — ${c.one_liner}${c.est_scale ? `（${c.est_scale}）` : ''}` });
    });
  }
  items.sort((a, b) => a.priority - b.priority);
  return items;
}

/**
 * 渲染 L1 Summary 六段 markdown，空段渲染"暂无"。
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
  lines.push('## 军师决策节 v2 · GP 批审桌');
  const gp = data.goldenPathMode || null;
  const actions = gp ? buildGpActionItems(gp) : [];
  const survivors = new Set(actions.slice(0, MAX_ALEX_ACTIONS));
  const overflow = actions.length - Math.min(actions.length, MAX_ALEX_ACTIONS);
  const pick = (segment) => actions.filter((a) => survivors.has(a) && a.segment === segment);

  lines.push('');
  lines.push('### 方向圈选段（每周一）');
  if (!gp) {
    lines.push('暂无');
  } else if (!gp.isMonday) {
    lines.push('本段每周一更新');
  } else {
    const sel = pick('selection');
    if (sel.length === 0 && !gp.gapPanorama) {
      lines.push('暂无');
    } else {
      for (const a of sel) lines.push(`- ${a.text}`);
      const gaps = gp.gapPanorama?.gaps || [];
      if (gaps.length > 0) {
        lines.push('OKR 缺口全景（本周无候选覆盖的空白）：');
        for (const g of gaps) lines.push(`- ${g.kr_title ?? g.kr_id}：${g.reason ?? ''}`);
      }
    }
  }

  lines.push('');
  lines.push('### GP 批审段');
  const review = gp ? pick('review') : [];
  if (review.length === 0) {
    lines.push('暂无');
  } else {
    for (const a of review) lines.push(`- ${a.text}`);
  }

  lines.push('');
  lines.push('### 报备段（24h 否决窗）');
  const releaseActions = gp ? pick('release') : [];
  // 否决窗条目属被动知情必须始终可见：非首次放行全走被动行；首次放行被 ≤7 截断的也回落为被动行
  const survivedReleaseIds = new Set(releaseActions.map((a) => a.releaseId));
  const passiveReleases = gp ? gp.autoReleases.filter((r) => !survivedReleaseIds.has(r.id)) : [];
  const ledger = gp?.dispatchLedger || [];
  if (releaseActions.length === 0 && passiveReleases.length === 0 && ledger.length === 0) {
    lines.push('暂无');
  } else {
    for (const a of releaseActions) lines.push(`- ${a.text}`);
    for (const r of passiveReleases) {
      lines.push(`- ${r.title}（否决窗至 ${formatShanghaiShort(r.veto_deadline)}，不否决即生效）`);
    }
    if (ledger.length > 0) {
      lines.push('昨日自动派工台账：');
      for (const t of ledger) lines.push(`- ${t.title}（${t.status ?? '?'}，${formatShanghaiShort(t.created_at)}）`);
    }
  }

  lines.push('');
  lines.push('### GP 库存水位段');
  const stock = gp?.stock || [];
  if (stock.length === 0) {
    lines.push('暂无');
  } else {
    lines.push(stock.map((s) => {
      const reason = ['rejected', 'blocked_gate'].includes(s.status) && s.latest_reason ? `（${s.latest_reason}）` : '';
      return `${s.status} ${s.count}${reason}`;
    }).join(' · '));
  }

  if (overflow > 0) {
    lines.push('');
    lines.push(`⏳ 需动作条目超限（>${MAX_ALEX_ACTIONS}），${overflow} 条顺延次日（堆积水位 ${overflow}）`);
  }

  lines.push('');
  lines.push('## 未确认动作（24h）');
  const ua = data.unconfirmedActions || [];
  if (ua.length === 0) {
    lines.push('暂无');
  } else {
    for (const r of ua) {
      lines.push(`- ${r.kind ?? '未知'} → ${r.target ?? '-'}：${r.receipt_status ?? '?'}（${formatShanghaiShort(r.sent_at)}）`);
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
