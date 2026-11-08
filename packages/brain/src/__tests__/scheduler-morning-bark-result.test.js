import './helpers/scheduler-jobs-fixture.js';
import { it, expect, vi } from "vitest";

import { runMorningCockpitBark } from '../morning-cockpit-bark.js';
import { runSchedulerJobsOnce, JOBS } from '../scheduler-jobs.js';
// 默认注册表必须消费真实发送结果，不能把返回false的通知记为成功。
it('晨报Bark拒绝发送时默认job记录失败，跳过仍是跳过', async () => {
  const job = JOBS.find(row => row.name === 'morning-cockpit-bark');
  expect(job).toBeDefined();
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  runMorningCockpitBark.mockResolvedValueOnce({ sent: false, error: 'bark_send_failed' });
  const [failure] = await runSchedulerJobsOnce(pool, [job]);
  expect(failure).toMatchObject({ name: 'morning-cockpit-bark', ok: false, error: 'bark_send_failed' });
  const sentinel = pool.query.mock.calls.find(([sql, params]) => /INSERT INTO working_memory/.test(String(sql)) && params?.[0] === 'scheduler_job_last_run:morning-cockpit-bark');
  expect(sentinel).toBeDefined();
  expect(JSON.parse(sentinel[1][1])).toMatchObject({ ok: false, error: 'bark_send_failed' });
  runMorningCockpitBark.mockResolvedValueOnce({ skipped: true, reason: 'already_attempted_today' });
  const [skipped] = await runSchedulerJobsOnce(pool, [job]);
  expect(skipped.ok).toBe(true);
  expect(JSON.parse(skipped.detail)).toEqual({ skipped: true, reason: 'already_attempted_today' });
});
