/**
 * Dev Reviews API — Phase 8.3
 *
 * 存储 + 查询 Structured Review Block（B-4/B-5/B-6/SDD-2/SDD-3）。
 * POST 可选接受 raw_markdown（走 parser）或结构化字段。
 */
import { Router } from 'express';
import pool from '../db.js';
import { parseReviewBlock, ParseError } from '../review-parser.js';

const router = Router();

const VALID_POINTS = new Set(['B-4', 'B-5', 'B-6', 'SDD-2', 'SDD-3']);
const VALID_DECISIONS = new Set(['APPROVE', 'REQUEST_CHANGES', 'PASS_WITH_CONCERNS']);
const VALID_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);

router.post('/dev-reviews', async (req, res) => {
  try {
    let payload = req.body || {};
    if (payload.raw_markdown && !payload.point_code) {
      try {
        const parsed = parseReviewBlock(payload.raw_markdown);
        payload = { ...parsed, ...payload, raw_markdown: payload.raw_markdown };
      } catch (err) {
        if (err instanceof ParseError) {
          return res.status(400).json({ error: 'parse_error', message: err.message });
        }
        throw err;
      }
    }
    const {
      pr_number, branch, point_code, decision, confidence, quality_score,
      risks, anchors_user_words, anchors_code, anchors_okr, next_step, raw_markdown,
    } = payload;

    if (!point_code || !VALID_POINTS.has(point_code)) {
      return res.status(400).json({ error: 'invalid_point_code', allowed: [...VALID_POINTS] });
    }
    if (!decision || !VALID_DECISIONS.has(decision)) {
      return res.status(400).json({ error: 'invalid_decision', allowed: [...VALID_DECISIONS] });
    }
    if (!confidence || !VALID_CONFIDENCE.has(confidence)) {
      return res.status(400).json({ error: 'invalid_confidence', allowed: [...VALID_CONFIDENCE] });
    }
    if (typeof quality_score !== 'number' || quality_score < 0 || quality_score > 10) {
      return res.status(400).json({ error: 'invalid_quality_score', range: '0-10' });
    }

    const { rows } = await pool.query(
      `INSERT INTO dev_reviews
        (pr_number, branch, point_code, decision, confidence, quality_score, risks,
         anchors_user_words, anchors_code, anchors_okr, next_step, raw_markdown)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, created_at`,
      [
        pr_number ?? null, branch ?? null, point_code, decision, confidence,
        quality_score, JSON.stringify(risks ?? []),
        anchors_user_words ?? null, anchors_code ?? null, anchors_okr ?? null,
        next_step ?? null, raw_markdown ?? null,
      ],
    );
    return res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

router.get('/dev-reviews', async (req, res) => {
  try {
    const { pr, point, limit } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 20, 100);
    const params = [];
    const where = [];
    if (pr) { params.push(parseInt(pr, 10)); where.push(`pr_number = $${params.length}`); }
    if (point) { params.push(point); where.push(`point_code = $${params.length}`); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(lim);
    const { rows } = await pool.query(
      `SELECT id, pr_number, branch, point_code, decision, confidence, quality_score,
              risks, anchors_user_words, anchors_code, anchors_okr, next_step, created_at
       FROM dev_reviews ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return res.json({ reviews: rows });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

router.get('/dev-reviews/stats', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT point_code,
              AVG(quality_score)::float AS avg_quality,
              COUNT(*)::int AS count,
              (SUM(CASE WHEN confidence = 'LOW' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS low_confidence_rate
       FROM dev_reviews
       GROUP BY point_code
       ORDER BY point_code`,
    );
    return res.json({ stats: rows });
  } catch (err) {
    return res.status(500).json({ error: 'internal', message: err.message });
  }
});

export default router;
