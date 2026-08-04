/**
 * /api/brain/captures — 统一进箱端点 + CRUD
 * FR-3: POST /api/brain/captures（进箱+幂等）
 * FR-8: GET/GET/:id（列表+详情+计数）
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_SOURCES = ['harness', 'dashboard', 'feishu', 'api', 'conversation-claude', 'conversation-codex', 'conversation-grok'];
const VALID_NATURES = ['learning', 'issue', 'handoff', 'session_summary'];

// PATCH /api/brain/captures/:id — 更新 status / dest_type / dest_id
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, dest_type, dest_id } = req.body;

    const VALID_STATUSES = ['captured', 'clarified', 'done', 'dropped'];
    const VALID_DEST_TYPES = ['project', 'initiative', 'task', 'knowledge'];

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    if (dest_type && !VALID_DEST_TYPES.includes(dest_type)) {
      return res.status(400).json({ error: `dest_type must be one of: ${VALID_DEST_TYPES.join(', ')}` });
    }
    if (dest_id && !dest_type) {
      return res.status(400).json({ error: 'dest_type is required when dest_id is set' });
    }

    const setClauses = [];
    const values = [];

    if (status !== undefined) { values.push(status); setClauses.push(`status = $${values.length}`); }
    if (dest_type !== undefined) { values.push(dest_type); setClauses.push(`dest_type = $${values.length}`); }
    if (dest_id !== undefined) { values.push(dest_id); setClauses.push(`dest_id = $${values.length}`); }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE captures SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING id, status, dest_type, dest_id, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'capture not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update capture', details: err.message });
  }
});

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
        `SELECT id, content, source, nature, repo, lane, ref_task_id, ref_journey_id, ref_pr_url, dedupe_key, status, dest_type, dest_id, created_at, updated_at
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

// GET /api/brain/captures/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const captureResult = await pool.query(
      `SELECT id, content, source, nature, repo, lane, ref_task_id, ref_journey_id, ref_pr_url, dedupe_key, status, dest_type, dest_id, created_at, updated_at
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

    // 构建回链
    const backlinks = atomsResult.rows
      .filter(a => a.routed_to_table && a.routed_to_id)
      .map(a => ({
        table: a.routed_to_table,
        id: a.routed_to_id,
        summary: `${a.target_type} → ${a.routed_to_table}`,
      }));

    res.json({ ...capture, atoms: atomsResult.rows, backlinks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get capture', details: err.message });
  }
});

export default router;
