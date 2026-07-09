/**
 * line-dreaming.js — L1 line 级夜间蒸馏 job（dreaming L1）
 *
 * 每晚北京 05:00（UTC 21:00，排在 battle-report 之前）把每条 active line（journey）
 * 的 24h 事实（decisions/journey_features/advancement_items/issues/initiative_runs/
 * learnings/军师留痕）蒸馏成一份 markdown 摘要，落 design_docs(type='line_ledger')。
 * diary / arch_review / strategy_session 三个 L3 文档改为消费这份摘要，不再各自
 * 重新拉一遍 24h 原始切片（口径统一 + 减少重复查询）。
 */

/** 每晚触发小时（UTC）= 北京时间 05:00 */
const LINE_DREAMING_HOUR_UTC = 21;

/**
 * 判断当前是否在夜间蒸馏窗口内（UTC 21:00-21:05 = 北京 05:00-05:05）。
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInLineDreamingWindow(now = new Date()) {
  return now.getUTCHours() === LINE_DREAMING_HOUR_UTC && now.getUTCMinutes() < 5;
}

/**
 * 该 journey 20h 内是否已有 line_ledger 记录（去重）。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @returns {Promise<boolean>}
 */
export async function alreadyDreamedToday(pool, journeyId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM design_docs
     WHERE type = 'line_ledger'
       AND journey_id = $1
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`,
    [journeyId]
  );
  return rows.length > 0;
}

/**
 * 拉所有 active journey（line）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function getActiveJourneys(pool) {
  const { rows } = await pool.query(
    `SELECT id, name FROM journeys WHERE status = 'active' ORDER BY name`
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/**
 * 单段查询容错包装：失败返回空数组，不抛出、不阻断其他段。
 * @param {Promise<{rows: Array}>} queryPromise
 * @param {string} label
 * @returns {Promise<Array>}
 */
async function safeRows(queryPromise, label) {
  try {
    const { rows } = await queryPromise;
    return rows;
  } catch (err) {
    console.warn(`[line-dreaming] ${label} 查询失败（该段留空）:`, err.message);
    return [];
  }
}

/**
 * 拉一条 line 的 24h 六段切片：decisions/推进项/issues/runs/learnings/军师留痕。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @param {string} journeyName
 * @returns {Promise<{decisions: Array, advancementItems: Array, issues: Array, runs: Array, learnings: Array, strategistNotes: Array}>}
 */
export async function buildLineDreamData(pool, journeyId, journeyName) {
  const [decisions, advancementItems, issues, runs, learnings, strategistNotes] = await Promise.all([
    safeRows(
      pool.query(
        `SELECT d.id, d.topic, d.decision, d.created_at
         FROM decisions d
         JOIN journey_features jf ON d.target_id = jf.id
         WHERE d.target_type = 'journey_feature'
           AND jf.journey_id = $1
           AND d.created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY d.created_at DESC`,
        [journeyId]
      ),
      'decisions'
    ),
    safeRows(
      pool.query(
        `SELECT id, title, status, priority, updated_at
         FROM advancement_items
         WHERE journey_id = $1
           AND updated_at >= NOW() - INTERVAL '24 hours'
         ORDER BY updated_at DESC`,
        [journeyId]
      ),
      'advancement_items'
    ),
    safeRows(
      pool.query(
        `SELECT id, title, priority, status, updated_at
         FROM issues
         WHERE journey_id = $1
           AND updated_at >= NOW() - INTERVAL '24 hours'
         ORDER BY updated_at DESC`,
        [journeyId]
      ),
      'issues'
    ),
    safeRows(
      pool.query(
        `SELECT id, phase, failure_reason, created_at
         FROM initiative_runs
         WHERE journey_id = $1
           AND created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY created_at DESC`,
        [journeyId]
      ),
      'initiative_runs'
    ),
    safeRows(
      pool.query(
        `SELECT l.id, l.content, l.created_at
         FROM learnings l
         JOIN tasks t ON l.task_id = t.id
         WHERE t.payload->>'journey_id' = $1
           AND l.created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY l.created_at DESC`,
        [journeyId]
      ),
      'learnings'
    ),
    safeRows(
      pool.query(
        `SELECT id, title, content, created_at
         FROM notes
         WHERE title LIKE $1
           AND created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY created_at DESC`,
        [`军师决策[${journeyName}]%`]
      ),
      'strategist_notes'
    ),
  ]);

  return { decisions, advancementItems, issues, runs, learnings, strategistNotes };
}

/**
 * 渲染一个数据段为 markdown 列表；空数组渲染"暂无"。
 * @param {Array<object>} rows
 * @param {(row: object) => string} formatter
 * @returns {string[]}
 */
function renderSection(rows, formatter) {
  if (rows.length === 0) return ['暂无'];
  return rows.map(formatter);
}

/**
 * 渲染 line_ledger 的 markdown 摘要（六段，空段"暂无"）。
 * @param {string} journeyName
 * @param {{decisions: Array, advancementItems: Array, issues: Array, runs: Array, learnings: Array, strategistNotes: Array}} data
 * @returns {string}
 */
export function renderLineLedgerMarkdown(journeyName, data) {
  const lines = [`# ${journeyName} — 24h 账本`, ''];

  lines.push('## 决策');
  lines.push(...renderSection(data.decisions, (d) => `- ${d.topic ?? '(无主题)'}：${d.decision ?? ''}`));
  lines.push('');

  lines.push('## 推进项变化');
  lines.push(...renderSection(data.advancementItems, (a) => `- ${a.title ?? '(无标题)'}（${a.status ?? '?'}）`));
  lines.push('');

  lines.push('## Issue 变化');
  lines.push(...renderSection(data.issues, (i) => `- [${i.priority ?? '?'}] ${i.title ?? '(无标题)'}（${i.status ?? '?'}）`));
  lines.push('');

  lines.push('## Run 战况');
  lines.push(...renderSection(data.runs, (r) => `- phase=${r.phase ?? '?'}${r.failure_reason ? `，失败原因：${r.failure_reason}` : ''}`));
  lines.push('');

  lines.push('## Learnings');
  lines.push(...renderSection(data.learnings, (l) => `- ${(l.content ?? '').slice(0, 100)}`));
  lines.push('');

  lines.push('## 军师留痕');
  lines.push(...renderSection(data.strategistNotes, (n) => `- ${n.title ?? '(无标题)'}`));
  lines.push('');

  return lines.join('\n');
}

/**
 * 落库：20h 内该 journey 已有记录则 UPDATE，否则 INSERT。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @param {string} journeyName
 * @param {string} markdown
 * @returns {Promise<void>}
 */
export async function upsertLineLedger(pool, journeyId, journeyName, markdown) {
  const { rows } = await pool.query(
    `SELECT id FROM design_docs
     WHERE type = 'line_ledger' AND journey_id = $1
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`,
    [journeyId]
  );

  if (rows.length > 0) {
    await pool.query(
      `UPDATE design_docs SET content = $2, updated_at = NOW() WHERE id = $1`,
      [rows[0].id, markdown]
    );
    return;
  }

  await pool.query(
    `INSERT INTO design_docs (type, title, content, journey_id, author)
     VALUES ('line_ledger', $1, $2, $3, 'cecelia')`,
    [`${journeyName} — 24h 账本`, markdown, journeyId]
  );
}

/**
 * 组合：拉切片 → 渲染 → 落库。
 * @param {import('pg').Pool} pool
 * @param {string} journeyId
 * @param {string} journeyName
 * @returns {Promise<void>}
 */
export async function generateLineLedger(pool, journeyId, journeyName) {
  const data = await buildLineDreamData(pool, journeyId, journeyName);
  const markdown = renderLineLedgerMarkdown(journeyName, data);
  await upsertLineLedger(pool, journeyId, journeyName, markdown);
}

/**
 * 夜间蒸馏主入口：窗口内遍历所有 active journey，逐条去重+生成，单条失败不影响其他 journey。
 * @param {import('pg').Pool} pool
 * @param {Date} [now]
 * @returns {Promise<{triggered: boolean, dreamed: number, skipped: number, failed: number}>}
 */
export async function maybeRunLineDreaming(pool, now = new Date()) {
  if (!isInLineDreamingWindow(now)) {
    return { triggered: false, dreamed: 0, skipped: 0, failed: 0 };
  }

  const journeys = await getActiveJourneys(pool);
  let dreamed = 0;
  let skipped = 0;
  let failed = 0;

  for (const journey of journeys) {
    try {
      const already = await alreadyDreamedToday(pool, journey.id);
      if (already) {
        skipped++;
        continue;
      }
      await generateLineLedger(pool, journey.id, journey.name);
      dreamed++;
    } catch (err) {
      console.warn(`[line-dreaming] journey ${journey.id} 蒸馏失败（跳过）:`, err.message);
      failed++;
    }
  }

  return { triggered: true, dreamed, skipped, failed };
}
