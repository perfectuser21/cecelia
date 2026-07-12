// golden_paths（GP 蓝图级提案实体）基础端点——GP loop T1
// select/approve/veto 三个拍板端点在 T7，不在本文件。
// 既有 /golden_path（单数下划线，routes/abilities.js，任务级 FR 台账）是另一实体。
import express from 'express';
import pool from '../db.js';

const router = express.Router();

export const GP_STATUSES = ['candidate', 'proposed', 'converged', 'approved', 'in_dev',
  'delivered', 'expired', 'rejected', 'blocked_gate', 'superseded'];
export const GP_SOURCES = ['strategist', 'alex_direct', 'capture_triage'];

// 状态机流转白名单（活清单原则：任何状态可捞回，superseded 终态）
export const ALLOWED_TRANSITIONS = {
  candidate:    ['proposed', 'rejected', 'superseded', 'blocked_gate'],
  proposed:     ['converged', 'rejected', 'superseded', 'blocked_gate'],
  converged:    ['approved', 'rejected', 'superseded', 'blocked_gate'],
  approved:     ['in_dev', 'expired', 'converged', 'superseded', 'blocked_gate'],
  in_dev:       ['delivered', 'superseded', 'blocked_gate'],
  expired:      ['converged', 'superseded', 'blocked_gate'],
  rejected:     ['candidate', 'superseded'],
  blocked_gate: ['candidate', 'proposed', 'converged', 'approved', 'in_dev', 'superseded'],
  delivered:    ['superseded'],
  superseded:   []
};

const PATCHABLE_FIELDS = ['one_liner', 'est_scale', 'proposal_doc', 'demo_url', 'judgment_refs',
  'findings_log', 'auto_release', 'veto_deadline', 'review_after', 'status_reason', 'proposal_task_id'];

router.get('/golden-paths', async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !GP_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `invalid status: ${status}` });
    }
    const { rows } = status
      ? await pool.query('SELECT * FROM golden_paths WHERE status = $1 ORDER BY created_at DESC', [status])
      : await pool.query('SELECT * FROM golden_paths ORDER BY created_at DESC');
    res.json({ success: true, golden_paths: rows });
  } catch (err) {
    console.error('[golden-paths] GET 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/golden-paths', async (req, res) => {
  try {
    const { title, one_liner, journey_id, kr_id, est_scale, source, proposal_doc } = req.body || {};
    if (!title || !one_liner) {
      return res.status(400).json({ success: false, error: 'title 和 one_liner 必填' });
    }
    if (source && !GP_SOURCES.includes(source)) {
      return res.status(400).json({ success: false, error: `invalid source: ${source}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO golden_paths (title, one_liner, journey_id, kr_id, est_scale, source, proposal_doc)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'strategist'), $7)
       RETURNING *`,
      [title, one_liner, journey_id || null, kr_id || null, est_scale || null, source || null, proposal_doc || null]
    );
    res.status(201).json({ success: true, golden_path: rows[0] });
  } catch (err) {
    console.error('[golden-paths] POST 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/golden-paths/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { rows: cur } = await pool.query('SELECT status FROM golden_paths WHERE id = $1', [id]);
    if (cur.length === 0) {
      return res.status(404).json({ success: false, error: 'golden_path not found', code: 'GP_NOT_FOUND' });
    }
    const currentStatus = cur[0].status;

    const sets = [];
    const vals = [];
    let i = 1;

    if (body.status !== undefined) {
      if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(body.status)) {
        return res.status(409).json({
          success: false,
          error: 'Invalid status transition',
          code: 'INVALID_TRANSITION',
          current_status: currentStatus,
          requested_status: body.status,
          allowed: ALLOWED_TRANSITIONS[currentStatus] || []
        });
      }
      sets.push(`status = $${i++}`);
      vals.push(body.status);
      if (body.status === 'approved') {
        sets.push(`approved_at = now()`);
        if (body.review_after === undefined) sets.push(`review_after = now() + interval '14 days'`);
      }
    }
    for (const f of PATCHABLE_FIELDS) {
      if (body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(f === 'findings_log' ? JSON.stringify(body[f]) : body[f]);
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, error: '无可更新字段' });
    }
    sets.push('updated_at = now()');
    vals.push(id, currentStatus);
    // compare-and-swap：SELECT 与 UPDATE 之间状态可能被 gp-shelf-life job 翻转，守卫住旧状态
    const { rows } = await pool.query(
      `UPDATE golden_paths SET ${sets.join(', ')} WHERE id = $${i} AND status = $${i + 1} RETURNING *`, vals);
    if (rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'golden_path 状态已被并发修改，请重读后重试',
        code: 'CONCURRENT_MODIFICATION'
      });
    }
    res.json({ success: true, golden_path: rows[0] });
  } catch (err) {
    console.error('[golden-paths] PATCH 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
