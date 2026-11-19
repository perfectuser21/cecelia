import { beginBrainLaunch, finishBrainLaunch } from '../drain.js';

export function brainLaunchHandler(taskIdFor, handler) {
  return async (req, res) => {
    const admission = beginBrainLaunch(taskIdFor(req));
    if (!admission) return res.status(503).json({ success: false, error: 'draining', reason: 'draining' });
    try { return await handler(req, res, admission); }
    finally { finishBrainLaunch(admission); }
  };
}
