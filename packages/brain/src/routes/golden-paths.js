// golden_paths（GP 蓝图级提案实体）基础端点——GP loop T1 + T7 拍板回路
// 既有 /golden_path（单数下划线，routes/abilities.js，任务级 FR 台账）是另一实体。
import express from 'express';
import pool from '../db.js';
import { getTotalEffectiveSlots } from '../fleet-resource-cache.js';

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

// ─── POST /golden-paths/:id/select — 圈选（candidate→proposed）+ 建提案任务 ─

router.post('/golden-paths/:id/select', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: cur } = await pool.query('SELECT * FROM golden_paths WHERE id = $1', [id]);
    if (cur.length === 0) {
      return res.status(404).json({ success: false, error: 'golden_path not found', code: 'GP_NOT_FOUND' });
    }
    const gp = cur[0];
    if (gp.status !== 'candidate') {
      return res.status(409).json({
        success: false,
        error: `圈选只能从 candidate 发起，当前状态: ${gp.status}`,
        code: 'INVALID_TRANSITION',
      });
    }

    // 批规模闸：≤2周产能上限（有效 slot 数即单批最大并行 GP 数）
    const batchLimit = Math.max(1, getTotalEffectiveSlots());
    const { rows: inflight } = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM golden_paths WHERE status IN ('proposed','converged','in_dev')"
    );
    const inFlightCount = inflight[0].cnt;
    if (inFlightCount >= batchLimit) {
      return res.status(409).json({
        success: false,
        error: `当前在途 GP 数（${inFlightCount}）已达 2 周产能上限（${batchLimit}），请顺延至下批圈选`,
        code: 'CAPACITY_EXCEEDED',
        in_flight: inFlightCount,
        batch_limit: batchLimit,
      });
    }

    // 建 golden_path_proposal 任务（直接 INSERT，task_type 已在 migration 335 注册）
    const taskTitle = `[GP] ${gp.title}`;
    const { rows: taskRows } = await pool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       VALUES ($1, $2, 'golden_path_proposal', 'queued', 'P1', $3::jsonb)
       RETURNING id`,
      [
        taskTitle,
        gp.one_liner || gp.title,
        JSON.stringify({ golden_path_id: id, title: gp.title, one_liner: gp.one_liner, orchestrator: 'skill-relay' }),
      ]
    );
    const proposalTaskId = taskRows[0].id;

    // 状态机：candidate → proposed，记录 proposal_task_id
    const { rows } = await pool.query(
      `UPDATE golden_paths
       SET status = 'proposed', proposal_task_id = $1, updated_at = now()
       WHERE id = $2 AND status = 'candidate'
       RETURNING *`,
      [proposalTaskId, id]
    );
    if (rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: '状态已被并发修改，请重读后重试',
        code: 'CONCURRENT_MODIFICATION',
      });
    }
    res.json({ success: true, golden_path: rows[0], proposal_task_id: proposalTaskId });
  } catch (err) {
    console.error('[golden-paths] /select 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /golden-paths/:id/approve — 批准（converged→approved）+ 写 judgment 判定点 ─

router.post('/golden-paths/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: cur } = await pool.query('SELECT * FROM golden_paths WHERE id = $1', [id]);
    if (cur.length === 0) {
      return res.status(404).json({ success: false, error: 'golden_path not found', code: 'GP_NOT_FOUND' });
    }
    const gp = cur[0];
    // 批准来源：converged（正式批审）或 proposed（auto_release 报备路径）
    const allowedSources = ['converged', 'proposed'];
    if (!allowedSources.includes(gp.status)) {
      return res.status(409).json({
        success: false,
        error: `批准只能从 converged 或 proposed 发起，当前状态: ${gp.status}`,
        code: 'INVALID_TRANSITION',
      });
    }

    // 写 decisions(category='judgment', review_after=now()+14d, reason 含 gp:<id>)
    const decisionReason = `gp:${id} 批准决策——${gp.title}。${gp.proposal_doc ? '提案已收敛。' : ''}`;
    const { rows: decRows } = await pool.query(
      `INSERT INTO decisions (category, topic, decision, reason, status, review_after)
       VALUES ('judgment', $1, 'approved', $2, 'active', now() + interval '14 days')
       RETURNING id`,
      [`gp:${id}`, decisionReason]
    );
    const judgmentId = decRows[0].id;

    // 冻结 proposal_doc（如果已有则保持，否则标记已批准时间点）
    const frozenDoc = gp.proposal_doc || null;

    // 注册 harness 实现任务（golden_path_proposal 已在 task-router 注册）
    const harnessTitle = `[GP harness] ${gp.title}`;
    const { rows: harnessRows } = await pool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       VALUES ($1, $2, 'golden_path_proposal', 'queued', 'P1', $3::jsonb)
       RETURNING id`,
      [
        harnessTitle,
        `批准后 harness 实现任务——${gp.one_liner}`,
        JSON.stringify({
          golden_path_id: id,
          title: gp.title,
          one_liner: gp.one_liner,
          proposal_doc: frozenDoc,
          judgment_decision_id: judgmentId,
          phase: 'implement',
          orchestrator: 'skill-relay',
        }),
      ]
    );
    const harnessTaskId = harnessRows[0].id;

    // 状态机：→ approved，写 judgment_refs、approved_at、review_after、冻结 proposal_doc
    const { rows } = await pool.query(
      `UPDATE golden_paths
       SET status = 'approved',
           judgment_refs = ARRAY[$1::uuid],
           approved_at = now(),
           review_after = now() + interval '14 days',
           proposal_doc = COALESCE($2, proposal_doc),
           proposal_task_id = COALESCE(proposal_task_id, $3),
           updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [judgmentId, frozenDoc, harnessTaskId, id]
    );
    res.json({
      success: true,
      golden_path: rows[0],
      judgment_decision_id: judgmentId,
      harness_task_id: harnessTaskId,
    });
  } catch (err) {
    console.error('[golden-paths] /approve 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /golden-paths/:id/veto — 否决 ─

router.post('/golden-paths/:id/veto', async (req, res) => {
  try {
    const { id } = req.params;
    const { status_reason } = req.body || {};
    const { rows: cur } = await pool.query('SELECT * FROM golden_paths WHERE id = $1', [id]);
    if (cur.length === 0) {
      return res.status(404).json({ success: false, error: 'golden_path not found', code: 'GP_NOT_FOUND' });
    }
    const gp = cur[0];

    // 报备中（proposed + auto_release）→ 回 converged 继续批审
    // 批审中（converged）→ rejected + status_reason
    let newStatus;
    if (gp.status === 'proposed' && gp.auto_release) {
      newStatus = 'converged';
    } else if (gp.status === 'converged') {
      newStatus = 'rejected';
    } else {
      return res.status(409).json({
        success: false,
        error: `否决只能从报备中(proposed+auto_release)或批审中(converged)发起，当前状态: ${gp.status}`,
        code: 'INVALID_TRANSITION',
      });
    }

    const { rows } = await pool.query(
      `UPDATE golden_paths
       SET status = $1,
           status_reason = $2,
           updated_at = now()
       WHERE id = $3 AND status = $4
       RETURNING *`,
      [newStatus, status_reason || null, id, gp.status]
    );
    if (rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: '状态已被并发修改，请重读后重试',
        code: 'CONCURRENT_MODIFICATION',
      });
    }
    res.json({ success: true, golden_path: rows[0] });
  } catch (err) {
    console.error('[golden-paths] /veto 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
