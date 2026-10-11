/**
 * 旁路报警路由（派发总闸 H，任务 865b502c）
 *   POST /api/brain/bypass-actions/report  —— 执行机上报一次动手机/对外动作（Brain 侧判定是否关联 Brain 任务，只记旁路）
 *   GET  /api/brain/bypass-actions/summary —— 运维视图：近 N 天按天 × 类别汇总 + 最近明细
 */
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';
import { recordBypassAction, summarizeBypass } from '../bypass-audit.js';

const router = Router();
// 内网宽松限流（CodeQL js/missing-rate-limiting）：执行机每次领锁/对外动作最多一次上报
const limiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false });

router.post('/bypass-actions/report', limiter, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await recordBypassAction(pool, {
      kind: b.kind, device: b.device, host: b.host, owner: b.owner, run_id: b.run_id, task_id: b.task_id,
      action: b.action, command: b.command, detail: b.detail, dedupe_key: b.dedupe_key,
      source: b.source || 'executor-report',
    });
    res.json({ success: true, ...r });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.startsWith('invalid_kind')) return res.status(400).json({ success: false, error: msg });
    console.error('[API] bypass-actions/report error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/bypass-actions/summary', limiter, async (req, res) => {
  try {
    const r = await summarizeBypass(pool, { days: req.query.days === undefined ? 7 : Number(req.query.days) });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[API] bypass-actions/summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
