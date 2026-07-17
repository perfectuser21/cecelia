/**
 * cron.js — 手动触发 cron 任务的 API 路由（供 E2E 测试使用）
 * POST /api/brain/cron/trigger { job: "disk-guard" | "worktree-reaper" }
 */
import { Router } from 'express';
const router = Router();

const JOB_HANDLERS = {
  'disk-guard': async () => {
    const { runDiskGuard, __resetDiskGuardForTest } = await import('../cron/disk-guard.js');
    __resetDiskGuardForTest();
    const logs = [];
    const orig = console.log.bind(console);
    console.log = (...a) => { logs.push(a.join(' ')); orig(...a); };
    let result;
    try { result = await runDiskGuard(); } finally { console.log = orig; }
    return { triggered: true, job: 'disk-guard', result, log: logs.find(l => l.includes('[disk_check]')) || '', all_logs: logs };
  },
  'worktree-reaper': async () => {
    const { runWorktreeReaper } = await import('../cron/worktree-reaper.js');
    const logs = [];
    const orig = console.log.bind(console);
    console.log = (...a) => { logs.push(a.join(' ')); orig(...a); };
    let result;
    try { result = await runWorktreeReaper(); } finally { console.log = orig; }
    return { triggered: true, job: 'worktree-reaper', result, all_logs: logs };
  },
};

router.post('/trigger', async (req, res) => {
  const { job } = req.body || {};
  if (!job) return res.status(400).json({ error: 'job 必填: disk-guard | worktree-reaper' });
  const handler = JOB_HANDLERS[job];
  if (!handler) return res.status(400).json({ error: `未知 job: ${job}` });
  try {
    const result = await handler();
    return res.json(result);
  } catch (err) {
    console.error(`[POST /cron/trigger] job=${job}`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
