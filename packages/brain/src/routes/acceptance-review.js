/**
 * acceptance-review.js — 复盘闭环两端点（D1 Task 11，A15②③⑤⑦）
 *
 * 从 routes/acceptance.js 分出来的直接原因是 500 行闸（同 Task 7 拆 acceptance-ai.js 的先例），
 * 但边界本身也成立：这两个端点一格判定都不碰，只在 run.detail 上记「谁认了、谁关的」，
 * 是发版链的握手层，和人列/AI 列两条写入路径互不重叠。
 *
 * | 端点 | 主体 | 前置闸 |
 * |---|---|---|
 * | POST  /runs/:run_key/review-ack    | 该 run 的人列提交人 | 无 |
 * | PATCH /runs/:run_key/review-closed | 发起人或主理人；员工 403 | 全员 ack 或距 adjudicated_at 满 24h |
 */

/** 员工零 ack 时的防死锁兜底窗口：一个不配合的员工不能把整条发版链锁死（A15⑤） */
export const REVIEW_ACK_FALLBACK_HOURS = 24;

/**
 * 主理人身份。每次调用重读 env，不做模块级快照——进程启动顺序与测试改 env
 * 都不该影响结论（同 acceptance-spec.js:resolveServerSpecPath 的约定）。
 */
export function ownerIdentity() {
  return process.env.ACCEPTANCE_OWNER_IDENTITY || 'alex';
}

/** 该 run 的人列提交人集合（= 需要 ack 的员工） */
export async function loadSubmitters(q, runId) {
  const { rows } = await q.query(
    `SELECT DISTINCT submitted_by FROM acceptance_checks
      WHERE run_id = $1 AND submitted_by IS NOT NULL`,
    [runId]
  );
  return rows.map((r) => r.submitted_by);
}

/**
 * 能不能关复盘。返回 null = 放行，否则返回 {status, body}。
 * @param {string} identity      X-Staff-Identity
 * @param {object} detail        acceptance_runs.detail
 * @param {string[]} submitters  该 run 的人列提交人
 */
export function checkReviewClosePermission(identity, detail, submitters) {
  // A15②：主体只能是发起人或主理人；员工一律 403
  const isOwner = identity === ownerIdentity();
  if (!isOwner && identity !== detail.created_by) {
    return { status: 403, body: { error: 'only initiator or owner can close review', identity } };
  }
  // A15③⑤：全员 ack 或距 adjudicated_at 满 24h（后者是防死锁兜底）
  const acked = new Set((detail.review_acks || []).map((a) => a.by));
  const pending = submitters.filter((s) => !acked.has(s));
  const adjudicatedAt = detail.adjudicated_at ? new Date(detail.adjudicated_at).getTime() : null;
  const fallbackReached = adjudicatedAt != null
    && Date.now() - adjudicatedAt >= REVIEW_ACK_FALLBACK_HOURS * 3600_000;
  if (!isOwner && pending.length > 0 && !fallbackReached) {
    return { status: 403, body: { error: 'review not acknowledged yet', pending_acks: pending } };
  }
  return null;
}

export function registerReviewClosureRoutes(router, { pool, safeRollback }) {
  router.post('/runs/:run_key/review-ack', async (req, res) => {
    const identity = req.get('X-Staff-Identity');
    if (!identity) return res.status(401).json({ error: 'X-Staff-Identity required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // FOR UPDATE：两个员工同时 ack 时，读改写整个 review_acks 数组会互相覆盖，
      // 后写的那次把先写的那条 ack 抹掉——闸随后判「还有人没认」，永远关不上。
      const { rows } = await client.query(
        'SELECT id, detail FROM acceptance_runs WHERE run_key = $1 FOR UPDATE',
        [req.params.run_key]
      );
      if (rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'run not found' });
      }
      const submitters = await loadSubmitters(client, rows[0].id);
      if (!submitters.includes(identity)) {
        await safeRollback(client);
        return res.status(403).json({ error: 'only human-column submitters can ack', identity });
      }
      const acks = rows[0].detail?.review_acks || [];
      if (!acks.some((a) => a.by === identity)) {
        acks.push({ by: identity, at: new Date().toISOString() });
      }
      await client.query(
        `UPDATE acceptance_runs SET detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb, updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify({ review_acks: acks }), rows[0].id]
      );
      await client.query('COMMIT');
      return res.json({ review_acks: acks });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] POST /review-ack error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  router.patch('/runs/:run_key/review-closed', async (req, res) => {
    const identity = req.get('X-Staff-Identity');
    if (!identity) return res.status(401).json({ error: 'X-Staff-Identity required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, detail FROM acceptance_runs WHERE run_key = $1 FOR UPDATE',
        [req.params.run_key]
      );
      if (rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'run not found' });
      }
      const detail = rows[0].detail || {};
      const submitters = await loadSubmitters(client, rows[0].id);
      const denied = checkReviewClosePermission(identity, detail, submitters);
      if (denied) {
        await safeRollback(client);
        return res.status(denied.status).json(denied.body);
      }

      await client.query(
        `UPDATE acceptance_runs SET detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb, updated_at = NOW()
          WHERE id = $2`,
        [
          JSON.stringify({ review_closed_at: new Date().toISOString(), review_closed_by: identity }),
          rows[0].id,
        ]
      );
      await client.query('COMMIT');
      return res.json({ review_closed_by: identity });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] PATCH /review-closed error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });
  return router;
}
