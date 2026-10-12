// 统一领单租约（派发总闸 G，任务 c5f6e683）：runner 认领带 lease_seconds，执行期间定时心跳续约；
// 心跳 409 lease_lost = Brain 已按租约回收 → 中止执行器、不再回写终态（不覆盖 Brain 的处置）。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { FAKE_EXECUTOR, FAKE_GH, startFakeBrain, codingTask, makeSandbox, runnerEnv, runOnceProcess } from './helpers/sandbox.mjs';

const T1 = 'aaaaaaa1-0000-4000-8000-000000000001';

describe('coding workflow runner × 统一领单租约', () => {
  let sb;
  let brain;
  beforeAll(() => { fs.chmodSync(FAKE_EXECUTOR, 0o755); fs.chmodSync(FAKE_GH, 0o755); });
  beforeEach(() => { sb = makeSandbox(); });
  afterEach(async () => { if (brain) await brain.close(); brain = null; sb.cleanup(); });

  const claimBody = () => JSON.parse(brain.calls.find((c) => c.method === 'POST' && /\/claim$/.test(c.path)).raw);

  it('认领请求体带 lease_seconds（默认 900，可由 CODING_WF_LEASE_SECONDS 覆盖）', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_LEASE_SECONDS: '1200' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(claimBody()).toMatchObject({ claimer: expect.any(String), executor_kind: 'coding-workflow-runner', lease_seconds: 1200 });
  }, 30000);

  it('执行中心跳续约；心跳 409 → 中止执行器，不写终态（Brain 已回收）', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)], heartbeatStatus: (n) => (n >= 2 ? 409 : 200) });
    const started = Date.now();
    const r = await runOnceProcess(runnerEnv(sb, brain.url, {
      FAKE_EXEC_MODE: 'hang',
      CODING_WF_HEARTBEAT_MS: '300',
      CODING_WF_RUN_TIMEOUT_MS: '20000',
      CODING_WF_KILL_GRACE_MS: '300',
    }));
    expect(r.exitCode, r.stderr).toBe(1);
    expect(Date.now() - started).toBeLessThan(15000);
    expect(brain.heartbeats.length).toBeGreaterThanOrEqual(2);
    expect(brain.heartbeats[0]).toMatchObject({ claimer: expect.any(String), lease_seconds: 900 });
    expect(brain.patches.map((p) => p.body.status)).toEqual(['in_progress']);
    expect(r.stderr).toContain('lease_lost');
  }, 30000);

  it('旧 Brain 没有心跳端点（404）→ 不中断，照常跑完', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_HEARTBEAT_MS: '50' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(brain.patches.map((p) => p.body.status).filter(Boolean)).toEqual(['in_progress', 'completed']);

  }, 30000);
});
