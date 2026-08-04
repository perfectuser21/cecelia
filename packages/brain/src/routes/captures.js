/**
 * /api/brain/captures — 统一进箱端点 + CRUD
 * FR-3: POST /api/brain/captures（进箱+幂等）
 * FR-8: GET/GET/:id（列表+详情+计数）
 * F6-S3: GET /aging（账龄哨兵）, PATCH /:id/done（归位完成）
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_SOURCES = ['harness', 'dashboard', 'feishu', 'api', 'conversation-claude', 'conversation-codex', 'conversation-grok'];
const VALID_NATURES = ['learning', 'issue', 'handoff', 'session_summary'];

/** 根据 routed_to_table 生成前端导航 URL */
function getNavigateUrl(table, id) {
  if (!table || !id) return null;
  switch (table) {
    case 'tasks':        return `/tasks/${id}/prd`;
    case 'golden_paths': return `/warroom/gp/${id}`;
    case 'journeys':     return `/warroom/line/${id}`;
    case 'decisions':    return `/warroom?decision=${id}`;
    case 'notes':        return `/knowledge/doc-chat?note=${id}`;
    default:             return null;
  }
}

// POST /api/brain/captures
router.post('/', async (req, res) => {
  const { content, source, nature, repo, lane, ref_task_id, ref_journey_id, ref_pr_url, dedupe_key } = req.body;

  // 校验
  if (!content || String(content).trim() === '') {
    return res.status(400).json({ error: 'content is required and cannot be empty' });
  }
  if (!source || !VALID_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source must be one of: ${VALID_SOURCES.join(', ')}` });
  }
  if (nature && !VALID_NATURES.includes(nature)) {
    return res.status(400).json({ error: `nature must be one of: ${VALID_NATURES.join(', ')}` });
  }

  // 出身判断：nature 有值 → clarified，否则 → captured
  const status = nature ? 'clarified' : 'captured';

  try {
    // dedupe_key 幂等
    if (dedupe_key) {
      const existing = await pool.query(
        'SELECT id, status, dedupe_key FROM captures WHERE dedupe_key = $1',
        [dedupe_key]
      );
      if (existing.rows.length > 0) {
        return res.status(200).json({ ...existing.rows[0], dedupe_hit: true });
      }
    }

    const result = await pool.query(
      `INSERT INTO captures (content, source, nature, repo, lane, ref_task_id, ref_journey_id, ref_pr_url, dedupe_key, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, status, dedupe_key, created_at`,
      [
        String(content).slice(0, 2000),
        source,
        nature || null,
        repo || null,
        lane || null,
        ref_task_id || null,
        ref_journey_id || null,
        ref_pr_url || null,
        dedupe_key || null,
        status,
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    // unique constraint on dedupe_key（race condition）
    if (err.code === '23505' && (err.constraint === 'captures_dedupe_key_unique' || err.constraint === 'captures_dedupe_key_key')) {
      const existing = await pool.query(
        'SELECT id, status, dedupe_key FROM captures WHERE dedupe_key = $1',
        [dedupe_key]
      );
      return res.status(200).json({ ...existing.rows[0], dedupe_hit: true });
    }
    res.status(500).json({ error: 'Failed to create capture', details: err.message });
  }
});

// GET /api/brain/captures/aging — 账龄哨兵：超期未处理条目
router.get('/aging', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days || '7', 10));
    const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
    const { rows } = await pool.query(
      `SELECT id, content, source, status, created_at,
              EXTRACT(DAY FROM (NOW() - created_at))::INT AS age_days
       FROM captures
       WHERE status NOT IN ('done','dropped')
         AND created_at < NOW() - ($1 || ' days')::INTERVAL
       ORDER BY created_at ASC
       LIMIT $2`,
      [days, limit]
    );
    res.json({ overdue: rows, count: rows.length, threshold_days: days });
  } catch (err) {
    res.status(500).json({ error: 'Failed to query aging captures', details: err.message });
  }
});

// GET /api/brain/captures
router.get('/', async (req, res) => {
  try {
    const { stage, nature, lane, aging, source, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];

    if (stage) {
      values.push(stage);
      conditions.push(`status = $${values.length}`);
    }
    if (nature) {
      values.push(nature);
      conditions.push(`nature = $${values.length}`);
    }
    if (lane) {
      values.push(lane);
      conditions.push(`lane = $${values.length}`);
    }
    if (source) {
      values.push(source);
      conditions.push(`source = $${values.length}`);
    }
    if (aging) {
      const days = parseInt(aging, 10);
      if (!isNaN(days)) {
        conditions.push(`created_at < now() - interval '${days} days'`);
        conditions.push(`status NOT IN ('done','dropped')`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = parseInt(limit, 10) || 50;
    const off = parseInt(offset, 10) || 0;

    const [itemsResult, countResult, totalResult] = await Promise.all([
      pool.query(
        `SELECT id, content, source, nature, repo, lane, ref_task_id, ref_journey_id, ref_pr_url, dedupe_key, status, created_at, updated_at
         FROM captures ${where} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, lim, off]
      ),
      pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status='captured') AS captured,
          COUNT(*) FILTER (WHERE status='clarified') AS clarified,
          COUNT(*) FILTER (WHERE status='done') AS done,
          COUNT(*) FILTER (WHERE status='dropped') AS dropped
         FROM captures`
      ),
      pool.query(`SELECT COUNT(*) FROM captures ${where}`, values),
    ]);

    const counts = countResult.rows[0];
    res.json({
      items: itemsResult.rows,
      total: parseInt(totalResult.rows[0].count, 10),
      counts_by_stage: {
        captured: parseInt(counts.captured, 10),
        clarified: parseInt(counts.clarified, 10),
        done: parseInt(counts.done, 10),
        dropped: parseInt(counts.dropped, 10),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list captures', details: err.message });
  }
});

// PATCH /api/brain/captures/:id/done — 归位完成，写 done_at + status=done + 返回 navigate_url
router.patch('/:id/done', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE captures SET status='done', done_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND status NOT IN ('done','dropped')
       RETURNING id, status, done_at`,
      [id]
    );
    if (!rows.length) {
      // 已是 done/dropped 或不存在，幂等返回当前状态
      const cur = await pool.query('SELECT id, status, done_at FROM captures WHERE id=$1', [id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'capture not found' });
      return res.json(cur.rows[0]);
    }
    // 找最近已路由的 atom，生成导航 URL
    const atomRes = await pool.query(
      `SELECT routed_to_table, routed_to_id FROM capture_atoms
       WHERE capture_id=$1 AND routed_to_table IS NOT NULL AND routed_to_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    const atom = atomRes.rows[0];
    const navigate_url = atom ? getNavigateUrl(atom.routed_to_table, atom.routed_to_id) : null;
    res.json({ ...rows[0], navigate_url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark capture done', details: err.message });
  }
});

// GET /api/brain/captures/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const captureResult = await pool.query(
      `SELECT id, content, source, nature, repo, lane, ref_task_id, ref_journey_id, ref_pr_url, dedupe_key, status, done_at, created_at, updated_at
       FROM captures WHERE id = $1`,
      [id]
    );
    if (captureResult.rows.length === 0) {
      return res.status(404).json({ error: 'capture not found' });
    }
    const capture = captureResult.rows[0];

    // 获取关联 atoms
    const atomsResult = await pool.query(
      `SELECT id, content, target_type, target_subtype, status, ai_reason, routed_to_table, routed_to_id, confidence, retry_count, created_at, updated_at
       FROM capture_atoms WHERE capture_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    // 构建回链，附带前端导航 URL
    const backlinks = atomsResult.rows
      .filter(a => a.routed_to_table && a.routed_to_id)
      .map(a => ({
        table: a.routed_to_table,
        id: a.routed_to_id,
        summary: `${a.target_type} → ${a.routed_to_table}`,
        navigate_url: getNavigateUrl(a.routed_to_table, a.routed_to_id),
      }));

    res.json({ ...capture, atoms: atomsResult.rows, backlinks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get capture', details: err.message });
  }
});

export default router;
