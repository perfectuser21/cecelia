// packages/brain/src/routes/clips.js
import { Router } from 'express';
import pool from '../db.js';
import { extractClip } from '../clips-extractor.js';

const router = Router();

/** POST /webhook — external webhook from n8n (accepts same payload as callback) */
router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.CLIPS_WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-secret'] !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { url, platform, title, transcript, text, images, note } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    // Upsert: if URL exists, update fields; otherwise insert
    const { rows } = await pool.query(
      `INSERT INTO clips (url, platform, title, transcript, images, status, processed_at)
       VALUES ($1, $2, $3, $4, $5, 'done', NOW())
       ON CONFLICT (url) DO UPDATE SET
         title = EXCLUDED.title,
         transcript = EXCLUDED.transcript,
         images = EXCLUDED.images,
         status = 'done',
         processed_at = NOW(),
         updated_at = NOW()
       RETURNING id, status`,
      [url, platform || detectPlatform(url), title || null, transcript || text || null, JSON.stringify(images || [])]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('[clips] POST /webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /:id/retry — reset failed clip to pending and re-trigger */
router.post('/:id/retry', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE clips SET status='pending', retry_count=retry_count+1, error_msg=NULL, updated_at=NOW()
       WHERE id=$1 RETURNING id, status, url`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    // Re-trigger extraction (non-blocking)
    extractClip(rows[0].id, rows[0].url).catch(e =>
      console.error('[clips] retry extractClip error:', e.message)
    );
    res.json({ id: rows[0].id, status: rows[0].status });
  } catch (err) {
    console.error('[clips] POST /:id/retry error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /:id/callback — internal: content-service posts result here */
router.post('/:id/callback', async (req, res) => {
  try {
    const { success, title, transcript, images, platform, author, author_id,
            like_count, comment_count, share_count, cover_url, video_url,
            raw_response, error } = req.body;

    if (success === false || success === 'false') {
      await pool.query(
        `UPDATE clips SET status='failed', error_msg=$2, updated_at=NOW() WHERE id=$1`,
        [req.params.id, error || 'content-service reported failure']
      );
      return res.json({ ok: true, status: 'failed' });
    }

    const { rows } = await pool.query(
      `UPDATE clips SET
         status='done', title=$2, transcript=$3, images=$4,
         author=$5, author_id=$6,
         like_count=$7, comment_count=$8, share_count=$9,
         cover_url=$10, video_url=$11,
         raw_response=$12, processed_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING id, status`,
      [
        req.params.id,
        title || null,
        transcript || null,
        JSON.stringify(images || []),
        author || null, author_id || null,
        like_count || null, comment_count || null, share_count || null,
        cover_url || null, video_url || null,
        raw_response ? JSON.stringify(raw_response) : null,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'clip not found' });
    res.json({ ok: true, status: 'done' });
  } catch (err) {
    console.error('[clips] POST /:id/callback error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST / — submit URL, create pending record, trigger extraction */
router.post('/', async (req, res) => {
  try {
    const { url, requested_by, metadata } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return res.status(400).json({ error: 'url required (must start with http)' });
    }

    const platform = detectPlatform(url);
    const { rows } = await pool.query(
      `INSERT INTO clips (url, platform, requested_by, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id, status, created_at`,
      [url.trim(), platform, requested_by || null, JSON.stringify(metadata || {})]
    );

    // Trigger extraction non-blocking
    extractClip(rows[0].id, url).catch(e =>
      console.error('[clips] extractClip error for', rows[0].id, e.message)
    );

    res.status(201).json({ id: rows[0].id, status: rows[0].status, created_at: rows[0].created_at });
  } catch (err) {
    if (err.code === '23505') {
      // Unique constraint violation — URL already exists
      const existing = await pool.query('SELECT id, status FROM clips WHERE url=$1', [req.body.url]);
      return res.status(409).json({ error: 'already_exists', id: existing.rows[0]?.id });
    }
    console.error('[clips] POST / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET / — list with optional filters */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const params = [limit, offset];
    const conditions = [];

    if (req.query.platform) {
      params.push(req.query.platform);
      conditions.push(`platform = $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`status = $${params.length}`);
    }
    if (req.query.since) {
      params.push(req.query.since);
      conditions.push(`created_at >= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT id, url, platform, status, title, author, like_count, comment_count,
              cover_url, retry_count, requested_by, created_at, processed_at, error_msg
       FROM clips ${where}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countParams = conditions.length ? params.slice(2) : [];
    const { rows: countRows } = await pool.query(
      `SELECT count(*) FROM clips ${where}`,
      countParams
    );

    res.json({ success: true, data: rows, total: parseInt(countRows[0].count) });
  } catch (err) {
    console.error('[clips] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /:id — full detail */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clips WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[clips] GET /:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function detectPlatform(url) {
  if (url.includes('douyin.com') || url.includes('v.douyin.com')) return 'douyin';
  if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) return 'xiaohongshu';
  return 'douyin'; // fallback
}

export default router;
