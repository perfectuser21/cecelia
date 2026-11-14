import { Router } from 'express';
import pool from '../db.js';
import { createTask } from '../actions.js';

const router = Router();

router.post('/promote/:resultId', async (req, res) => {
  const { resultId } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(resultId)) return res.status(400).json({ error: 'invalid resultId (uuid required)' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 行级锁 + 仅 pending_promote 可放行（幂等：并发/重复 confirm 只第一次生效）
    const sel = await client.query(
      `SELECT id, initiative_id, pr_url, verdict, promote_status FROM staging_e2e_results WHERE id = $1::uuid FOR UPDATE`,
      [resultId]
    );
    if (sel.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'staging_e2e_result not found' }); }
    const row = sel.rows[0];
    if (row.promote_status !== 'pending_promote') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `not pending_promote (current=${row.promote_status})`, promote_status: row.promote_status });
    }
    await client.query(`UPDATE staging_e2e_results SET promote_status = 'promoting' WHERE id = $1::uuid`, [resultId]);
    await client.query('COMMIT');

    // 放行：本 repo 内部线跑 promote 脚本；客户线只记录确认（不跨 repo）。
    const { resolveLine, runInternalPromote, defaultPromoteExec, getRepoRoot, PROMOTE_STATUS,
             } = await import('../staging-promote.js');
    const line = resolveLine(req.body?.base_repo || '');
    let finalStatus = PROMOTE_STATUS.PROMOTED;
    let output = 'owner confirmed';
    if (line === 'internal') {
      const r = await runInternalPromote({ promoteExec: defaultPromoteExec(getRepoRoot()) });
      finalStatus = r.ok ? PROMOTE_STATUS.PROMOTED : PROMOTE_STATUS.PROMOTE_FAILED;
      output = r.output;
    } else {
      // 客户线/unknown：决策1 不跨 repo 打 zenithjoy 生产，只标已放行
      output = `owner confirmed (customer line: real zenithjoy prod promote handled by zenithjoy repo gate)`;
    }
    await pool.query(
      `UPDATE staging_e2e_results SET promote_status = $2, promote_output = $3, promoted_at = now(),
        promoted_by = COALESCE($4, promoted_by) WHERE id = $1::uuid`,
      [resultId, finalStatus, String(output).slice(0, 4000), req.body?.promoted_by || 'owner']
    );
    return res.json({ ok: finalStatus !== PROMOTE_STATUS.PROMOTE_FAILED, resultId, promote_status: finalStatus });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('[POST /staging/promote/:resultId]', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


router.post('/e2e', async (req, res) => {
  const { pr_url, pr_branch, sub_task_id, initiative_id, journey_id, base_repo, project_id } = req.body || {};
  if (!pr_url) return res.status(400).json({ error: 'pr_url 必填' });
  const payload = {
    pr_url,
    pr_branch: pr_branch || '',
    sub_task_id: sub_task_id || '',
    initiative_id: initiative_id || '',
    journey_id: journey_id || '',
    base_repo: base_repo || '',
    project_id: project_id || '',
  };
  try {
    const existing = await pool.query(
      `SELECT id FROM tasks
       WHERE task_type = 'staging_e2e' AND payload->>'pr_url' = $1
       LIMIT 1`,
      [pr_url],
    );
    if (existing.rows.length > 0) {
      return res.json({ created: false, reason: 'already_exists' });
    }
    await createTask({
      title: `[Staging E2E] ${pr_branch || pr_url}`,
      description: `Post-merge staging acceptance: deploy :5222 + contract E2E for ${pr_url}`,
      task_type: 'staging_e2e',
      status: 'queued',
      priority: 'P2',
      payload,
      trigger_source: 'staging_gate',
      source: 'child',
      source_id: `staging-e2e:${pr_url}`,
      allow_unscoped: true,
      db: pool,
    });
    const created = true;
    if (created) console.log(`[staging-e2e endpoint] spawned staging_e2e task for pr=${pr_url}`);
    return res.json(created ? { created: true } : { created: false, reason: 'already_exists' });
  } catch (err) {
    console.error('[POST /staging/e2e]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});

export default router;
