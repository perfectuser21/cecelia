// packages/brain/src/ledger-hygiene.js
/**
 * ledger-hygiene.js — 账本保鲜守卫 tick job（九要素 T1）
 *
 * 每晚北京 05:10（UTC 21:10，line-dreaming 05:00 后、battle-report 06:00 前）
 * 计算 5 项账本卫生指标，落 design_docs(type='ledger_hygiene') 供晨报/军师消费。
 * 每项"欠账数"走棘轮（只许降不许升，基线=首跑快照）：击穿开 [ledger-hygiene] P2
 * issue，连续 3 天击穿升 P1 + Bark。棘轮状态存 working_memory（不解析 markdown 回读）。
 *
 * 指标定义见 docs/architecture/2026-07-10-nine-elements-integrity/architecture.md。
 */
import { sendBark } from './notifier.js';
import { pushCaptureAtom } from './capture-inbox.js';

/** 每晚触发窗口（UTC）= 北京时间 05:10-05:15 */
const LEDGER_HYGIENE_HOUR_UTC = 21;
const WINDOW_MINUTE_START = 10;
const WINDOW_MINUTE_END = 15;

export const RATCHET_KEY = 'ledger_hygiene_ratchet';

/** 判断当前是否在守卫窗口内（UTC 21:10-21:15）。 */
export function isInLedgerHygieneWindow(now = new Date()) {
  return (
    now.getUTCHours() === LEDGER_HYGIENE_HOUR_UTC &&
    now.getUTCMinutes() >= WINDOW_MINUTE_START &&
    now.getUTCMinutes() < WINDOW_MINUTE_END
  );
}

/** 单指标计算容错包装：失败返回 enabled=false 的占位，不阻断其他指标。 */
async function safeMetric(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[ledger-hygiene] 指标 ${fallback.key} 计算失败（标记未启用）:`, err.message);
    return { ...fallback, enabled: false, error: err.message };
  }
}

const toInt = (v) => parseInt(v ?? '0', 10) || 0;

/**
 * 计算 5 项卫生指标。每项 {key, name, value, debt, enabled}。
 * debt=欠账数（棘轮口径）；enabled=false 表示该指标暂不可用/未激活，不参与棘轮。
 */
export async function computeMetrics(pool) {
  const m1 = await safeMetric(async () => {
    // FR 沉淀率：近 7 天 merged 的 harness run 中 golden_path 有行的比例
    const { rows } = await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (
                WHERE NOT EXISTS (SELECT 1 FROM golden_path gp WHERE gp.owner_task_id = t.id)
              ) AS debt
       FROM tasks t
       WHERE t.task_type = 'harness_initiative'
         AND t.status = 'completed'
         AND t.pr_merged_at IS NOT NULL
         AND t.completed_at >= NOW() - INTERVAL '7 days'`
    );
    const total = toInt(rows[0]?.total);
    const debt = toInt(rows[0]?.debt);
    return { key: 'm1', name: 'FR沉淀率', value: total === 0 ? 1 : (total - debt) / total, debt, enabled: true };
  }, { key: 'm1', name: 'FR沉淀率', value: null, debt: 0 });

  const m2 = await safeMetric(async () => {
    // 归属完整率：近 7 天新建 tasks/issues 的 journey 归属 + harness 任务 ability 归属
    const [t, i, h] = await Promise.all([
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE COALESCE(payload->>'journey_id', '') = '') AS debt
         FROM tasks /* attribution_tasks */
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE journey_id IS NULL) AS debt
         FROM issues /* attribution_issues */
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE ability_id IS NULL) AS debt
         FROM tasks /* attribution_harness */
         WHERE task_type = 'harness_initiative'
           AND created_at >= NOW() - INTERVAL '7 days'`
      ),
    ]);
    const total = toInt(t.rows[0]?.total) + toInt(i.rows[0]?.total) + toInt(h.rows[0]?.total);
    const debt = toInt(t.rows[0]?.debt) + toInt(i.rows[0]?.debt) + toInt(h.rows[0]?.debt);
    return { key: 'm2', name: '归属完整率', value: total === 0 ? 1 : (total - debt) / total, debt, enabled: true };
  }, { key: 'm2', name: '归属完整率', value: null, debt: 0 });

  const m3 = await safeMetric(async () => {
    // 回执核销率：pending 超 24h 未核销数。表全空 = T4 未上线，未激活。
    const probe = await pool.query(`SELECT 1 FROM action_receipts LIMIT 1`);
    if (probe.rows.length === 0) {
      return { key: 'm3', name: '回执核销', value: null, debt: 0, enabled: false };
    }
    const { rows } = await pool.query(
      `SELECT count(*) AS debt
       FROM action_receipts
       WHERE receipt_status = 'pending'
         AND sent_at < NOW() - INTERVAL '24 hours'`
    );
    return { key: 'm3', name: '回执核销', value: null, debt: toInt(rows[0]?.debt), enabled: true };
  }, { key: 'm3', name: '回执核销', value: null, debt: 0 });

  const m4 = await safeMetric(async () => {
    // 知识保质期：review_after 到点未复审的决策数（06f78c9a 月度扫描欠账）
    const { rows } = await pool.query(
      `SELECT count(*) AS debt
       FROM decisions
       WHERE review_after IS NOT NULL
         AND review_after < NOW()`
    );
    return { key: 'm4', name: '知识保质期', value: null, debt: toInt(rows[0]?.debt), enabled: true };
  }, { key: 'm4', name: '知识保质期', value: null, debt: 0 });

  const m5 = await safeMetric(async () => {
    // 判定点活性：近 30 天新增 judgment 条数。从未有过 = T5 未上线，未激活；
    // 已激活且 30 天 0 条 = 学习回路断电，计 debt=1。
    const ever = await pool.query(
      `SELECT 1 FROM decisions WHERE category = 'judgment' LIMIT 1`
    );
    if (ever.rows.length === 0) {
      return { key: 'm5', name: '判定点活性', value: null, debt: 0, enabled: false };
    }
    const { rows } = await pool.query(
      `SELECT count(*) AS cnt
       FROM decisions /* judgment_recent */
       WHERE category = 'judgment'
         AND created_at >= NOW() - INTERVAL '30 days'`
    );
    const cnt = toInt(rows[0]?.cnt);
    // absolute：断电是绝对条件（debt>0 即击穿），不走棘轮相对比较
    return { key: 'm5', name: '判定点活性', value: cnt, debt: cnt === 0 ? 1 : 0, enabled: true, absolute: true };
  }, { key: 'm5', name: '判定点活性', value: null, debt: 0 });

  return { m1, m2, m3, m4, m5 };
}

/**
 * 棘轮比较（纯函数）：enabled 指标 debt 较上次上升即击穿。
 * @returns {{state: object, breaches: Array<{key, name, prevDebt, debt, streak}>}}
 */
export function evaluateRatchet(metrics, prev, today) {
  const state = {
    baseline: { ...(prev?.baseline ?? {}) },
    last: {},
    streaks: {},
    baseline_date: prev?.baseline_date ?? today,
  };
  const breaches = [];

  for (const m of Object.values(metrics)) {
    if (!m.enabled) continue;
    if (state.baseline[m.key] === undefined) state.baseline[m.key] = m.debt;
    const prevDebt = prev?.last?.[m.key];
    const prevStreak = prev?.streaks?.[m.key] ?? 0;
    // absolute 指标（如 m5 断电）debt>0 即击穿（含首跑）；普通指标走棘轮相对比较
    const isBreach = m.absolute ? m.debt > 0 : prevDebt !== undefined && m.debt > prevDebt;
    if (isBreach) {
      const streak = prevStreak + 1;
      state.streaks[m.key] = streak;
      breaches.push({ key: m.key, name: m.name, prevDebt: prevDebt ?? 0, debt: m.debt, streak });
    } else {
      state.streaks[m.key] = 0;
    }
    state.last[m.key] = m.debt;
  }

  return { state, breaches };
}

/** 渲染卫生分 markdown（5 指标表格 + 击穿段）。 */
export function renderHygieneMarkdown(today, metrics, breaches) {
  const lines = [`# 账本卫生分 ${today}`, ''];
  lines.push('| 指标 | 值 | 欠账 | 状态 |');
  lines.push('|---|---|---|---|');
  for (const m of Object.values(metrics)) {
    const value =
      typeof m.value === 'number' && m.value <= 1 && m.key !== 'm5'
        ? `${Math.round(m.value * 100)}%`
        : (m.value ?? '—');
    lines.push(`| ${m.name} | ${value} | ${m.debt} | ${m.enabled ? '启用' : '未启用'} |`);
  }
  lines.push('');
  lines.push('## 棘轮击穿');
  if (breaches.length === 0) {
    lines.push('无');
  } else {
    for (const b of breaches) {
      lines.push(`- **${b.name}** 欠账 ${b.prevDebt} → ${b.debt}（连续第 ${b.streak} 天击穿）`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** 读棘轮状态（无记录返回 null，解析失败视为无）。 */
async function loadRatchet(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = '${RATCHET_KEY}' LIMIT 1`
    );
    if (rows.length === 0) return null;
    const raw = rows[0].value_json;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    console.warn('[ledger-hygiene] 棘轮状态读取失败（按首跑处理）:', err.message);
    return null;
  }
}

/** 写棘轮状态（upsert）。 */
async function saveRatchet(pool, state) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [RATCHET_KEY, JSON.stringify(state)]
  );
}

/** 击穿告警：开 issue（streak≥3 升 P1 + Bark）。失败只 warn 不阻断。 */
export async function raiseBreachAlerts(pool, breaches, today) {
  for (const b of breaches) {
    const escalated = b.streak >= 3;
    const priority = escalated ? 'P1' : 'P2';
    const title = `[ledger-hygiene] ${b.name} 欠账上升 ${b.prevDebt}→${b.debt}（${today}）`;
    try {
      // 每指标每日最多一条 issue：当日已有同指标 issue 则跳过 INSERT 与 Bark
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM issues
         WHERE title LIKE $1 AND created_at >= CURRENT_DATE
         LIMIT 1`,
        [`[ledger-hygiene] ${b.name}%`]
      );
      if (dup.length > 0) continue;
      const { rows: inserted } = await pool.query(
        `INSERT INTO issues (title, priority, status, sub_area, body, journey_id)
         VALUES ($1, $2, 'In progress', 'brain', $3, NULL) RETURNING id`,
        [
          title,
          priority,
          `账本保鲜守卫棘轮击穿：指标「${b.name}」欠账 ${b.prevDebt} → ${b.debt}，连续第 ${b.streak} 天。` +
            `指标定义见 docs/architecture/2026-07-10-nine-elements-integrity/architecture.md；` +
            `当日分数卡见 design_docs(type='ledger_hygiene')。`,
        ]
      );
      // T10 统一收件箱：issue 落库后顺手进箱
      await pushCaptureAtom(pool, {
        content: `issue: ${title}`,
        targetType: 'issue',
        targetSubtype: priority,
        routedToTable: 'issues',
        routedToId: inserted[0]?.id ?? null,
      });
    } catch (err) {
      console.warn('[ledger-hygiene] issue 写入失败:', err.message);
    }
    if (escalated) {
      await sendBark(
        `📉 账本保鲜连续 ${b.streak} 天击穿`,
        `${b.name} 欠账 ${b.prevDebt}→${b.debt}，已升 P1，请处理。`
      ).catch((err) => console.warn('[ledger-hygiene] Bark 发送失败:', err.message));
    }
  }
}

/** 落库：20h 内已有当日记录则 UPDATE，否则 INSERT。 */
async function upsertHygieneDoc(pool, today, markdown) {
  const { rows } = await pool.query(
    `SELECT id FROM design_docs
     WHERE type = 'ledger_hygiene'
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`
  );
  if (rows.length > 0) {
    await pool.query(`UPDATE design_docs SET content = $2, updated_at = NOW() WHERE id = $1`, [
      rows[0].id,
      markdown,
    ]);
    return;
  }
  await pool.query(
    `INSERT INTO design_docs (type, title, content, author)
     VALUES ($1, $2, $3, 'cecelia')`,
    ['ledger_hygiene', `账本卫生分 ${today}`, markdown]
  );
}

/**
 * 守卫主入口：窗口 gate → 20h 去重 → 算指标 → 棘轮 → 告警 → 落库 → 存棘轮状态。
 * @returns {Promise<{triggered: boolean, skipped?: boolean, breaches?: number}>}
 */
export async function maybeRunLedgerHygiene(pool, now = new Date()) {
  if (!isInLedgerHygieneWindow(now)) {
    return { triggered: false };
  }

  const { rows } = await pool.query(
    `SELECT id FROM design_docs
     WHERE type = 'ledger_hygiene'
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`
  );
  if (rows.length > 0) {
    return { triggered: true, skipped: true };
  }

  // 北京日期（与 battle-report 先例一致）：UTC 21:10 已是北京次日凌晨
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
  const metrics = await computeMetrics(pool);
  const prev = await loadRatchet(pool);
  const { state, breaches } = evaluateRatchet(metrics, prev, today);

  await raiseBreachAlerts(pool, breaches, today);
  await upsertHygieneDoc(pool, today, renderHygieneMarkdown(today, metrics, breaches));
  await saveRatchet(pool, state);

  return { triggered: true, skipped: false, breaches: breaches.length };
}
