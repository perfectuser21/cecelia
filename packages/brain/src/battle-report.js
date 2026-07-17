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
 *   ⑦ harness admission 吞吐（dispatch_events 24h 派发/拒发 + machine_vitals_daily_peak 峰值，de6d3582 T2）
 * 落 design_docs(type='battle_report') + 飞书链接（best-effort，失败不回滚）。
 *
 * 调度：scheduler-jobs.js 60s 轮询 + 本模块自 gate（窗口 + 20h 去重），
 * 照 daily-backup-scheduler.js 先例。
 */
import { sendFeishu } from './notifier.js';
import { getUnconfirmedReceipts } from './receipt-collector.js';
import { getMachineVitals } from './machine-vitals.js';

/** 每日触发小时（UTC）= 北京时间 06:00 */
const BATTLE_REPORT_HOUR_UTC = 22;

// admission 拒发 reason 白名单（slot-allocator.harnessSlotCheck + dispatcher 兜底全集）
export const ADMISSION_DENY_REASONS = [
  'cap_reached', 'vitals_stale', 'vitals_error', 'disk_pressure', 'memory_pressure',
  'no_memory_headroom', 'quota_critical', 'quota_low_priority', 'inflight_query_error', 'task_cap_backstop',
];

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
 * @returns {Promise<{mergedPrs: Array, journeyRuns: Array, userDecisions: Array, sentinel: object, unconfirmedActions: Array, goldenPathMode: object|null, admission: object}>}
 */
export async function buildBattleReportData(pool, now = new Date()) {
  // ① merged PR（dev_records 断供容忍：恒空则渲染"暂无"）
  const { rows: mergedPrs } = await pool.query(
    `SELECT pr_title, pr_url, merged_at
     FROM dev_records
     WHERE merged_at >= NOW() - interval '24 hours'
       AND is_canary IS DISTINCT FROM TRUE
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

  // ⑦ harness admission 吞吐（beeba317 观察哨，de6d3582）
  let admission = { dispatched_24h: 0, denies: [], peak: null, vitals: null, codex_test_gen_24h: 0 };
  try {
    const { rows: dispRows } = await pool.query(
      `SELECT count(*)::int AS n FROM dispatch_events
        WHERE event_type = 'dispatched' AND created_at >= NOW() - interval '24 hours'`
    );
    const { rows: denyRows } = await pool.query(
      `SELECT reason, count(*)::int AS count FROM dispatch_events
        WHERE event_type = 'failed_dispatch'
          AND reason = ANY($1::text[])
          AND created_at >= NOW() - interval '24 hours'
        GROUP BY reason ORDER BY count DESC`,
      [ADMISSION_DENY_REASONS]
    );
    const { rows: peakRows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'machine_vitals_daily_peak'`
    );
    // codex_test_gen 24h 计数（07172225-codex-pool-activation）
    const { rows: codexRows } = await pool.query(
      `SELECT count(*)::int AS n FROM tasks
        WHERE task_type = 'codex_test_gen'
          AND created_at > NOW() - interval '24 hours'`
    );
    admission = {
      dispatched_24h: dispRows[0]?.n ?? 0,
      denies: denyRows,
      peak: peakRows[0]?.value_json ?? null,
      vitals: getMachineVitals(),
      codex_test_gen_24h: codexRows[0]?.n ?? 0,
    };
  } catch (err) {
    console.warn(`[battle-report] admission 段取数失败(渲染暂无): ${err.message}`);
  }

  return { mergedPrs, journeyRuns, userDecisions, sentinel: { jobs, expected, healthy }, unconfirmedActions, goldenPathMode, admission };
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
  lines.push('## Harness admission 吞吐（24h）');
  const adm = data.admission || { dispatched_24h: 0, denies: [], peak: null, vitals: null, codex_test_gen_24h: 0 };
  const denyTotal = adm.denies.reduce((s, d) => s + (d.count || 0), 0);
  if (adm.dispatched_24h === 0 && denyTotal === 0 && !adm.peak) {
    lines.push('暂无');
  } else {
    const peakStr = adm.peak ? `容器峰值 ${adm.peak.peak}` : '容器峰值 暂无';
    const vitalsStr = adm.vitals && !adm.vitals.stale
      ? `当前 ${adm.vitals.relay_count} 容器 / VM 余 ${Math.max(0, (adm.vitals.vm_total_mb ?? 0) - (adm.vitals.vm_used_mb ?? 0))}MB / 盘 ${adm.vitals.host_disk_pct}%`
      : '当前体征 stale';
    lines.push(`- 派发 ${adm.dispatched_24h} 次｜admission 拒发 ${denyTotal} 次｜${peakStr}｜${vitalsStr}`);
    for (const d of adm.denies) lines.push(`  - ${d.reason}: ${d.count}`);
  }
  // codex_test_gen 24h 计数段（07172225-codex-pool-activation）
  const codexCount = adm.codex_test_gen_24h ?? 0;
  lines.push(`- codex_test_gen 24h 入队：${codexCount} 个`);

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
 * PPT 卡片式 HTML 渲染器 — 将 buildBattleReportData 的结果转为可视化 HTML。
 * 精简文案 + 卡片布局 + 颜色状态，代替原先纯文本 ul/li 排版。
 * @param {Awaited<ReturnType<typeof buildBattleReportData>>} data
 * @param {string} day - YYYY-MM-DD（北京时间）
 * @returns {string} 完整 HTML 字符串
 */
export function renderBattleReportHTML(data, day) {
  const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const trunc = (s, n) => { const str = String(s ?? ''); return str.length > n ? str.slice(0, n - 1) + '…' : str; };

  const prCount = data.mergedPrs.length;
  const decCount = data.userDecisions.length;
  const { healthy, jobs = [], expected } = data.sentinel || {};
  const healthLabel = healthy ? '✅ 哨兵健康' : '⚠️ 哨兵异常';
  const healthClass = healthy ? 'stat-ok' : 'stat-warn';

  // 各线战况卡
  const linesHtml = data.journeyRuns.length === 0
    ? '<p class="empty">24h 内无 run 记录</p>'
    : data.journeyRuns.map((j) => {
        const pct = Math.round(j.success_rate * 100);
        const cls = pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad';
        const runs = j.runs;
        const failNote = j.failed > 0 ? `<span class="fail-note">失败 ${j.failed}</span>` : '';
        return `<div class="line-chip">
  <div class="line-name">${e(trunc(j.journey_name, 16))}</div>
  <div class="line-stats">
    <div class="bar-track"><div class="bar-fill ${cls}-bg" style="width:${pct}%"></div></div>
    <span class="pct ${cls}-c">${pct}%</span>
    <span class="run-count">${runs}run</span>${failNote}
  </div>
</div>`;
      }).join('');

  // 哨兵状态卡
  const sentinelHtml = jobs.length === 0
    ? '<p class="empty">暂无哨兵数据</p>'
    : jobs.map((j) => {
        const stale = j.age_seconds > SENTINEL_STALE_SECONDS;
        const cls = j.ok && !stale ? 's-ok' : stale ? 's-warn' : 's-bad';
        const icon = j.ok && !stale ? '✓' : stale ? '⏱' : '✗';
        return `<span class="s-pill ${cls}">${icon} ${e(j.name)}</span>`;
      }).join('');

  // 用户决策卡（显示前8条，超出折叠）
  const MAX_DEC = 8;
  const decisionsHtml = data.userDecisions.length === 0
    ? '<p class="empty">24h 内无用户决策</p>'
    : (() => {
        const show = data.userDecisions.slice(0, MAX_DEC);
        const hidden = data.userDecisions.slice(MAX_DEC);
        const rows = show.map((d) => `<li>
  <span class="dec-text">${e(trunc(d.topic, 60))}</span>
  <span class="dec-time">${e(formatShanghaiShort(d.created_at))}</span>
</li>`).join('');
        const extra = hidden.length > 0
          ? `<li class="more-row" id="moreToggle" onclick="document.getElementById('hiddenDecs').style.display='block';this.style.display='none'">
  <span class="more-btn">+ 展开另外 ${hidden.length} 条 ▾</span>
</li>
<div id="hiddenDecs" style="display:none">${hidden.map((d) => `<li>
  <span class="dec-text">${e(trunc(d.topic, 60))}</span>
  <span class="dec-time">${e(formatShanghaiShort(d.created_at))}</span>
</li>`).join('')}</div>`
          : '';
        return `<ul class="dec-list">${rows}${extra}</ul>`;
      })();

  // GP 批审桌卡
  const gp = data.goldenPathMode || null;
  const actions = gp ? buildGpActionItems(gp) : [];
  const gpHtml = (() => {
    if (!gp) return '<p class="empty">GP 数据不可用</p>';
    if (actions.length === 0) return '<p class="empty">今日无需人工动作</p>';
    const TAG = { review: '批审', release: '报备', selection: '圈选' };
    const TAG_CLS = { review: 'tag-review', release: 'tag-release', selection: 'tag-select' };
    return actions.slice(0, MAX_ALEX_ACTIONS).map((a) => `<div class="gp-item">
  <span class="gp-tag ${TAG_CLS[a.segment] ?? ''}">${TAG[a.segment] ?? a.segment}</span>${e(trunc(a.text.replace(/^【[^】]+】/, ''), 80))}
</div>`).join('');
  })();

  // GP 库存水位
  const stock = gp?.stock || [];
  const stockSummary = stock.length === 0 ? '' : stock.map((s) => `<span class="s-pill s-ok">${e(s.status)} ${s.count}</span>`).join('');

  // 合并 PR 卡
  const prsHtml = prCount === 0
    ? '<p class="empty">24h 内无合并 PR</p>'
    : data.mergedPrs.map((pr) => `<div class="pr-item">
  ${pr.pr_url ? `<a href="${e(pr.pr_url)}" target="_blank">${e(trunc(pr.pr_title, 80))}</a>` : `<span>${e(trunc(pr.pr_title, 80))}</span>`}
</div>`).join('');

  const genTime = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>作战日报 ${e(day)}</title>
<style>
:root{--bg:#f0f4f8;--surface:#fff;--ink:#1a2233;--soft:#4d5a6e;--faint:#8a96a8;--border:#e2e8f0;
  --accent:#2563eb;--accent-s:#eff6ff;--ok:#059669;--ok-s:#ecfdf5;--warn:#d97706;--warn-s:#fffbeb;
  --bad:#dc2626;--bad-s:#fef2f2;
  --sans:-apple-system,"PingFang SC","Hiragino Sans GB",system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media(prefers-color-scheme:dark){:root{
  --bg:#0f1520;--surface:#161d2b;--ink:#e2e8f0;--soft:#8ea0b5;--faint:#4d5f72;--border:#2a3648;
  --accent:#7ba7f9;--accent-s:#1b2740;--ok:#34d399;--ok-s:#052e16;--warn:#fbbf24;--warn-s:#292100;--bad:#f87171;--bad-s:#2d0d0d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.6}
.wrap{max-width:980px;margin:0 auto;padding:24px 16px 60px}

/* Hero */
.hero{background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);color:#fff;border-radius:16px;padding:26px 28px;margin-bottom:18px}
.hero .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin-bottom:6px}
.hero h1{margin:0 0 18px;font-size:22px;font-weight:800}
.stats-row{display:flex;gap:12px;flex-wrap:wrap}
.stat{background:rgba(255,255,255,.15);backdrop-filter:blur(4px);border-radius:12px;padding:12px 16px;flex:1;min-width:90px;text-align:center}
.stat .n{font-size:26px;font-weight:800;line-height:1.1}
.stat .l{font-size:11px;opacity:.75;margin-top:3px}
.stat-ok .n{color:#6ee7b7}
.stat-warn .n{color:#fcd34d}

/* Layout */
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
@media(max-width:600px){.row{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:14px}
.card-title{font-size:11px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;display:flex;align-items:center;gap:6px}
.card-title .ct-badge{font-family:var(--mono);font-size:10px;font-weight:800;background:var(--border);border-radius:9px;padding:1px 7px;color:var(--soft)}
.empty{color:var(--faint);font-style:italic;font-size:13px;margin:0}

/* Lines grid */
.lines-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media(max-width:420px){.lines-grid{grid-template-columns:1fr}}
.line-chip{background:var(--bg);border-radius:10px;padding:10px 12px}
.line-name{font-size:12px;font-weight:700;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line-stats{display:flex;align-items:center;gap:6px;font-size:11px}
.bar-track{flex:1;height:5px;border-radius:3px;background:var(--border);overflow:hidden}
.bar-fill{height:100%;border-radius:3px;transition:width .3s}
.pct{font-family:var(--mono);font-size:11px;font-weight:700;min-width:30px;text-align:right}
.run-count{color:var(--faint);min-width:28px}
.fail-note{color:var(--bad);font-family:var(--mono)}
.ok-c{color:var(--ok)}.warn-c{color:var(--warn)}.bad-c{color:var(--bad)}
.ok-bg{background:var(--ok)}.warn-bg{background:var(--warn)}.bad-bg{background:var(--bad)}

/* Sentinel */
.s-pills{display:flex;flex-wrap:wrap;gap:6px}
.s-pill{font-family:var(--mono);font-size:11px;padding:3px 9px;border-radius:20px;font-weight:600;white-space:nowrap}
.s-ok{background:var(--ok-s);color:var(--ok)}.s-warn{background:var(--warn-s);color:var(--warn)}.s-bad{background:var(--bad-s);color:var(--bad)}

/* Decisions */
.dec-list{list-style:none;margin:0;padding:0}
.dec-list li{display:flex;justify-content:space-between;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border);gap:8px}
.dec-list li:last-child,.more-row{border-bottom:none}
.dec-text{flex:1;font-size:13px;color:var(--ink)}
.dec-time{font-family:var(--mono);font-size:11px;color:var(--faint);white-space:nowrap;padding-top:2px}
.more-btn{display:inline-block;margin-top:6px;font-size:12px;color:var(--accent);cursor:pointer;background:none;border:none;padding:0}

/* GP cards */
.gp-item{background:var(--accent-s);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:9px 12px;margin-bottom:7px;font-size:13px;color:var(--ink)}
.gp-item:last-child{margin-bottom:0}
.gp-tag{font-family:var(--mono);font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-right:5px;vertical-align:middle}
.tag-review{background:var(--warn-s);color:var(--warn)}.tag-release{background:var(--ok-s);color:var(--ok)}.tag-select{background:var(--accent-s);color:var(--accent)}

/* PR list */
.pr-item{padding:7px 0;border-bottom:1px solid var(--border);font-size:13px}
.pr-item:last-child{border-bottom:none}
.pr-item a{color:var(--accent);text-decoration:none}
.pr-item a:hover{text-decoration:underline}

footer{margin-top:20px;text-align:center;font-family:var(--mono);font-size:11px;color:var(--faint)}
</style>
</head>
<body>
<div class="wrap">

<div class="hero">
  <div class="eyebrow">Cecelia · Daily Battle Report</div>
  <h1>作战日报 ${e(day)}</h1>
  <div class="stats-row">
    <div class="stat"><div class="n">${prCount}</div><div class="l">PR 合并</div></div>
    <div class="stat"><div class="n">${decCount}</div><div class="l">用户决策</div></div>
    <div class="stat ${healthClass}"><div class="n">${healthy ? jobs.length : '⚠'}</div><div class="l">${healthLabel}</div></div>
    ${expected != null ? `<div class="stat"><div class="n">${jobs.length}/${expected}</div><div class="l">哨兵 job</div></div>` : ''}
  </div>
</div>

<div class="row">
  <div class="card">
    <div class="card-title">各线战况 <span class="ct-badge">24h</span></div>
    <div class="lines-grid">${linesHtml}</div>
  </div>
  <div class="card">
    <div class="card-title">哨兵状态</div>
    <div class="s-pills">${sentinelHtml}</div>
    ${stockSummary ? `<div style="margin-top:10px"><div class="card-title" style="margin-bottom:6px">GP 库存水位</div><div class="s-pills">${stockSummary}</div></div>` : ''}
  </div>
</div>

<div class="card">
  <div class="card-title">用户决策 <span class="ct-badge">${decCount} 条</span></div>
  ${decisionsHtml}
</div>

<div class="card">
  <div class="card-title">GP 批审桌</div>
  ${gpHtml}
</div>

<div class="card">
  <div class="card-title">合并 PR <span class="ct-badge">${prCount}</span></div>
  ${prsHtml}
</div>

<footer>作战日报 ${e(day)} · 生成于北京时间 ${genTime} · Cecelia Brain 自动生成</footer>
</div>
</body>
</html>`;
}

/**
 * 尝试将 HTML 上传到 HK VPS /data/docs/daily-report/index.html（best-effort，失败不回滚）。
 * @param {string} html
 * @param {string} day
 */
async function uploadHtmlToHkVps(html, day) {
  const { writeFileSync } = await import('fs');
  const { execFileSync } = await import('child_process');
  const tmp = `/tmp/battle-report-${day}.html`;
  try {
    writeFileSync(tmp, html, 'utf8');
    execFileSync('ssh', [
      '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10',
      'hk-vps',
      `sudo mkdir -p /data/docs/daily-report && sudo tee /data/docs/daily-report/index.html > /dev/null`,
    ], { input: html, timeout: 20000 });
    console.log('[battle-report] HTML 已上传 HK VPS /data/docs/daily-report/');
  } catch (err) {
    console.warn('[battle-report] HTML 上传 HK VPS 失败（不回滚）:', err.message);
  }
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

  const html = renderBattleReportHTML(data, day);
  await uploadHtmlToHkVps(html, day);

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
