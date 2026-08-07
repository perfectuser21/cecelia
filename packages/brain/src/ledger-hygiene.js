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

/**
 * 守卫自产 capture atom 的 content 前缀（与 raiseBreachAlerts 写入格式同源）。
 * m7 分类 SQL 与写入侧共用本常量，防单边改动使 organic/self 分类静默失效。
 */
export const LEDGER_SELF_ATOM_PREFIX = 'issue: [ledger-hygiene]';

/**
 * 守卫自产 issue 的 title 前缀（与 raiseBreachAlerts 写入 title 及当日去重查询同源）。
 * m2 issues 子查询的自产排除谓词由本常量派生，防单边改文案使排除谓词静默失效
 * （同 m7 的 LEDGER_SELF_ATOM_PREFIX 同源模式）。
 */
export const LEDGER_SELF_ISSUE_PREFIX = '[ledger-hygiene]';

/**
 * m7 capture 统计的确定性窗口：北京（Asia/Shanghai）昨日自然日 [00:00:00, 24:00:00)
 * 对应的 UTC 时刻对。仅依赖 now 的北京日历日——同一北京日内任意时刻调用结果完全一致，
 * 消除 NOW()-24h 滑动窗的调度秒级漂移竞态（2026-08-03 误击穿根因）。
 */
export function getM7CaptureWindow(now = new Date()) {
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
  const todayMidnight = new Date(`${day}T00:00:00+08:00`);
  return { startUtc: new Date(todayMidnight.getTime() - 86400000), endUtc: todayMidnight };
}

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
export async function computeMetrics(pool, now = new Date()) {
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
    // 归属完整率：近 7 天新建 tasks/issues 的 journey 归属。
    // 排除守卫自产与冒烟噪声（debt 与 total 同步排除，防分母被噪声稀释）：
    //   - tasks：守卫击穿 → capture-triage 建的 '[紧急] issue: [ledger-hygiene]%' task
    //     （前缀由 '[紧急] ' 模板 + LEDGER_SELF_ATOM_PREFIX 拼接派生，与写入侧同源）
    //     与 payload.smoke_tag 非空的 headed 派发冒烟 task
    //   - issues：守卫自产 '[ledger-hygiene]%' 前缀 issue（LEDGER_SELF_ISSUE_PREFIX 同源）
    // attribution_harness 子指标（tasks.ability_id IS NULL）停计：ability_id 未接线
    // （全库仅 15 行非空），恒空即纯噪声源，且 harness 任务缺 journey_id 时会被
    // tasks/harness 两条子查询双重计数——ability_id 接线后恢复该子项属后续 sprint。
    const [t, i] = await Promise.all([
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE COALESCE(payload->>'journey_id', '') = '') AS debt
         FROM tasks /* attribution_tasks */
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND title NOT LIKE '[紧急] ${LEDGER_SELF_ATOM_PREFIX}%'
           AND payload->>'smoke_tag' IS NULL`
      ),
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE journey_id IS NULL) AS debt
         FROM issues /* attribution_issues */
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND title NOT LIKE '${LEDGER_SELF_ISSUE_PREFIX}%'`
      ),
    ]);
    const total = toInt(t.rows[0]?.total) + toInt(i.rows[0]?.total);
    const debt = toInt(t.rows[0]?.debt) + toInt(i.rows[0]?.debt);
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

  const m6 = await safeMetric(async () => {
    // evaluator 门禁覆盖率：近 7 天 v2 relay run 里 phase='done' 的行，
    // 有多少缺失 initiative_run_events(node='evaluator', status='done')——
    // 缺失即"PR 合并但从未经 evaluator 验收"（c36326c8 machine gate 配套指标）。
    const { rows } = await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (
                WHERE NOT EXISTS (
                  SELECT 1 FROM initiative_run_events e
                  WHERE e.initiative_id = r.initiative_id AND e.node = 'evaluator' AND e.status = 'done'
                )
              ) AS debt
       FROM initiative_runs r
       WHERE r.orchestrator_version = 'v2'
         AND r.phase = 'done'
         AND r.completed_at >= NOW() - INTERVAL '7 days'`
    );
    const total = toInt(rows[0]?.total);
    const debt = toInt(rows[0]?.debt);
    return { key: 'm6', name: 'evaluator门禁覆盖率', value: total === 0 ? 1 : (total - debt) / total, debt, enabled: true };
  }, { key: 'm6', name: 'evaluator门禁覆盖率', value: null, debt: 0 });

  const m7 = await safeMetric(async () => {
    // 自主循环零产出：上一完整北京日（Asia/Shanghai 昨日自然日）内，下列"应产出"
    // 循环是否出现零产出天——
    // (a) strategist：design_docs(type='strategy_session') 上一北京日行数（合同 78e812c0 同窗口口径）
    // (b) capture：capture_atoms 北京昨日自然日窗口内的**有机**产出（排除守卫自产 atom）
    // 规则：各项探针先查"历史上有没有产出过"，从未产出=未激活(enabled=false)；
    // capture 激活且窗口内有机产出 organic===0 → captureDebt=1（自产 atom 不算产出，
    // 防指标自指假绿）；capture 窗口界经 getM7CaptureWindow 参数化传入，禁 NOW() 滑动窗
    // （防调度秒级漂移误击穿——08-03/08-04 两次误报根因，合并自 #4597 + 本单）。
    const PREV_BEIJING_DAY_WINDOW = `
         created_at >= ((date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '1 day') AT TIME ZONE 'Asia/Shanghai')
         AND created_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')`;

    // (a) strategist 上一完整北京日
    const strat = await pool.query(
      `SELECT count(*) AS cnt FROM design_docs
       WHERE type = 'strategy_session'
         AND ${PREV_BEIJING_DAY_WINDOW}`
    );
    const stratEver = await pool.query(
      `SELECT 1 FROM design_docs WHERE type = 'strategy_session' LIMIT 1`
    );
    const stratActivated = stratEver.rows.length > 0;
    const stratDebt = stratActivated && toInt(strat.rows[0]?.cnt) === 0 ? 1 : 0;

    // (b) capture_atoms 北京昨日自然日窗口 organic/self 分解
    let captureActivated = false;
    let captureDebt = 0;
    let organic = null;
    let selfCnt = null;
    try {
      const capEver = await pool.query(
        `SELECT 1 FROM capture_atoms LIMIT 1`
      );
      captureActivated = capEver.rows.length > 0;
      if (captureActivated) {
        const { startUtc, endUtc } = getM7CaptureWindow(now);
        const cap = await pool.query(
          `SELECT count(*) FILTER (WHERE content NOT LIKE '${LEDGER_SELF_ATOM_PREFIX}%') AS organic,
                  count(*) FILTER (WHERE content LIKE '${LEDGER_SELF_ATOM_PREFIX}%') AS self
           FROM capture_atoms
           WHERE created_at >= $1 AND created_at < $2`,
          [startUtc.toISOString(), endUtc.toISOString()]
        );
        organic = toInt(cap.rows[0]?.organic);
        selfCnt = toInt(cap.rows[0]?.self);
        captureDebt = organic === 0 ? 1 : 0;
      }
    } catch {
      // capture_atoms 表可能未激活，忽略（capture 分支降级未激活，organic/self 保持 null）
    }

    const totalDebt = stratDebt + captureDebt;
    const activated = stratActivated || captureActivated;
    if (!activated) {
      return { key: 'm7', name: '自主循环零产出', value: null, debt: 0, enabled: false };
    }
    return {
      key: 'm7',
      name: '自主循环零产出',
      value: { stratDebt, captureDebt, organic, self: selfCnt },
      debt: totalDebt,
      enabled: true,
      absolute: true,
    };
  }, { key: 'm7', name: '自主循环零产出', value: null, debt: 0 });

  return { m1, m2, m3, m4, m5, m6, m7 };
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

/** 渲染卫生分 markdown（m1-m7 指标表格 + 击穿段）。 */
export function renderHygieneMarkdown(today, metrics, breaches) {
  const lines = [`# 账本卫生分 ${today}`, ''];
  lines.push('| 指标 | 值 | 欠账 | 状态 |');
  lines.push('|---|---|---|---|');
  for (const m of Object.values(metrics)) {
    let value;
    if (typeof m.value === 'object' && m.value !== null && m.key === 'm7') {
      // m7 value 是 { stratDebt, captureDebt, organic, self } 对象
      value = JSON.stringify(m.value);
    } else if (typeof m.value === 'number' && m.value <= 1 && !['m5', 'm7'].includes(m.key)) {
      value = `${Math.round(m.value * 100)}%`;
    } else {
      value = m.value ?? '—';
    }
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
    // 文案如实（08-04）：absolute 指标 debt 持平时不再写"上升 X→X"，改为持平表述；
    // title 前缀 [ledger-hygiene] <指标名> 逐字不变（每指标每日一条频控的去重键）。
    let deltaText;
    if (b.prevDebt === b.debt) {
      deltaText = `欠账持平 ${b.debt}（连续第 ${b.streak} 天）`;
    } else if (b.debt > b.prevDebt) {
      deltaText = `欠账上升 ${b.prevDebt}→${b.debt}`;
    } else {
      deltaText = `欠账 ${b.prevDebt}→${b.debt}`;
    }
    const title = `${LEDGER_SELF_ISSUE_PREFIX} ${b.name} ${deltaText}（${today}）`;
    try {
      // 每指标每日最多一条 issue：当日已有同指标 issue 则跳过 INSERT 与 Bark
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM issues
         WHERE title LIKE $1 AND created_at >= CURRENT_DATE
         LIMIT 1`,
        [`${LEDGER_SELF_ISSUE_PREFIX} ${b.name}%`]
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
      // T10 统一收件箱：issue 落库后顺手进箱（lane 打标自产来源，m7 统计排除自产防自污染）
      await pushCaptureAtom(pool, {
        content: `issue: ${title}`,
        targetType: 'issue',
        targetSubtype: priority,
        routedToTable: 'issues',
        routedToId: inserted[0]?.id ?? null,
        lane: 'ledger-hygiene',
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
  const metrics = await computeMetrics(pool, now);
  const prev = await loadRatchet(pool);
  const { state, breaches } = evaluateRatchet(metrics, prev, today);

  await raiseBreachAlerts(pool, breaches, today);
  await upsertHygieneDoc(pool, today, renderHygieneMarkdown(today, metrics, breaches));
  await saveRatchet(pool, state);

  return { triggered: true, skipped: false, breaches: breaches.length };
}
