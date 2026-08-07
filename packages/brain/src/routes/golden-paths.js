// golden_paths（GP 蓝图级提案实体）基础端点——GP loop T1 + T7 拍板回路
// 既有 /golden_path（单数下划线，routes/abilities.js，任务级 FR 台账）是另一实体。
import express from 'express';
import pool from '../db.js';
import { getTotalEffectiveSlots } from '../fleet-resource-cache.js';
import {
  GoldenPathContractError,
  createGoldenPathContractVersion,
  launchLatestSignedGoldenPath,
} from '../golden-path-contracts.js';

const router = express.Router();

async function withTransaction(operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[golden-paths] transaction rollback 失败:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

function sendContractError(res, error) {
  if (!(error instanceof GoldenPathContractError)) return false;
  res.status(error.status).json({
    success: false,
    error: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  });
  return true;
}

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
    const { status, journey_id } = req.query;
    if (status && !GP_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `invalid status: ${status}` });
    }
    const conditions = [];
    const params = [];
    if (status) { conditions.push(`status = $${params.length + 1}`); params.push(status); }
    if (journey_id) { conditions.push(`journey_id = $${params.length + 1}`); params.push(journey_id); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM golden_paths ${where} ORDER BY created_at DESC`,
      params
    );
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

// GET /api/brain/golden-paths/:id — 单条 GP 详情，含 journey steps 信息（steps_count + steps[]）
// 供 harness 诊断「GP steps_count=0」场景使用；step_id 缺失 → fail-loud（返回 steps_count=0 + warn）
router.get('/golden-paths/:id', async (req, res) => {
  try {
    const { rows: gpRows } = await pool.query(
      'SELECT * FROM golden_paths WHERE id = $1', [req.params.id]
    );
    if (gpRows.length === 0) return res.status(404).json({ success: false, error: 'GP not found' });
    const gp = gpRows[0];

    let steps = [];
    let steps_count = 0;
    if (gp.journey_id) {
      const { rows: stepRows } = await pool.query(
        'SELECT id, step_number, name, promise, status FROM journey_steps WHERE journey_id=$1 ORDER BY step_number',
        [gp.journey_id]
      );
      steps = stepRows;
      steps_count = stepRows.length;
    }

    // 防御：steps_count=0 时 fail-loud（warn 级别，不阻断读取但明确标记异常）
    if (gp.journey_id && steps_count === 0) {
      console.warn(`[golden-paths] GP=${req.params.id} journey=${gp.journey_id} steps_count=0 — anchor 无法安全引用，需立即补步骤`);
    }

    res.json({ success: true, golden_path: { ...gp, steps_count, steps } });
  } catch (err) {
    console.error('[golden-paths] GET /:id 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/golden-paths/:id/contracts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
         FROM golden_path_contract_versions
        WHERE golden_path_id = $1
        ORDER BY version DESC`,
      [req.params.id],
    );
    res.json({ success: true, contract_versions: rows });
  } catch (error) {
    console.error('[golden-paths] GET contracts 失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/golden-paths/:id/contracts', async (req, res) => {
  try {
    const contract = req.body?.contract ?? req.body;
    const result = await withTransaction((client) => (
      createGoldenPathContractVersion(client, {
        goldenPathId: req.params.id,
        contract,
      })
    ));
    res.status(result.idempotent ? 200 : 201).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (sendContractError(res, error)) return;
    console.error('[golden-paths] POST contracts 失败:', error);
    res.status(500).json({ success: false, error: error.message });
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

// ─── POST /golden-paths/:id/approve — 兼容入口：只返回最新已签合同绑定的任务 ─

router.post('/golden-paths/:id/approve', async (req, res) => {
  try {
    const result = await withTransaction((client) => (
      launchLatestSignedGoldenPath(client, {
        goldenPathId: req.params.id,
        expectedVersion: req.body?.expected_version,
      })
    ));
    res.json({
      success: true,
      contract_version: result.contract_version,
      harness_task_id: result.task.id,
      idempotent: result.idempotent,
    });
  } catch (error) {
    if (sendContractError(res, error)) return;
    console.error('[golden-paths] /approve 失败:', error);
    res.status(500).json({ success: false, error: error.message });
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
