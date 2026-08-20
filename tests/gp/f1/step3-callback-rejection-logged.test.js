// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：runner 回执 ↔ Brain 回调路由的拒绝可观测性
//
// 2026-08-20 生产实证（run 425c5279 attempt d9b8a653）：evaluator 容器 exit=75
// （= entrypoint 判定回执被 4xx 永久拒绝，execDuration=477s——活干完了），而 Brain 端
// **一行日志都没有**：哪个状态码、哪条校验分支拒的，全靠猜。回执是 attempt 的终态申明，
// 拒掉它等于判死这个 attempt——判死必须留下拒因（同族：#4963 provider_mismatch、
// #4965 worker 5xx 留痕、r19 publisher 409）。
//
// 按产物闸规矩写在边上：真 harness-callback 路由（不 vi.mock 被改模块本身），
// 只 mock 它的依赖（store/db/notifier——那些不是本次被改的边）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';

const mocks = {
  store: {
    getById: vi.fn(),
    recordCallbackTerminal: vi.fn(),
    assertFreshRoleSession: vi.fn(async () => true),
    heartbeat: vi.fn(),
    markRunning: vi.fn(),
    fail: vi.fn(),
  },
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
};

vi.mock('../../../packages/brain/src/orchestrator/attempt-store.js', () => ({
  createAttemptStore: () => mocks.store,
  normalizeRoleVerdict: (_role, verdict) => verdict,
}));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: mocks.pool }));
vi.mock('../../../packages/brain/src/lib/harness-thread-lookup.js', () => ({ lookupHarnessThread: vi.fn() }));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ sendBark: vi.fn() }));
vi.mock('../../../packages/brain/src/lib/harness-orphan-guard.js', () => ({
  handleRelayExitConsistency: vi.fn(async () => ({ action: 'noop' })),
}));

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'attempt-callback-secret';
const LEASE_OWNER = 'brain-1:123';

const attempt = {
  id: ATTEMPT_ID,
  run_id: RUN_ID,
  hop: 4,
  role: 'evaluator',
  provider: 'claude',
  status: 'running',
  lease_owner: LEASE_OWNER,
  lease_generation: 0,
  requested_machine_id: 'us-mac-m4',
  actual_machine_id: 'us-mac-m4',
  execution_transport: 'fleet-worker',
  remote_job_id: 'container-1',
  machine_attestation_status: 'verified',
  callback_secret_hash: createHash('sha256').update(TOKEN).digest('hex'),
  task_bundle: { expected_output: 'harness-result/evaluator-v1', inputs: {} },
};

describe('F1 step3 — 回执被拒必须留下拒因（Brain 端日志）', () => {
  let app; let warnings; let warnSpy;

  beforeEach(async () => {
    vi.resetModules();
    warnings = [];
    warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => { warnings.push(a.join(' ')); });
    mocks.store.getById.mockResolvedValue({ ...attempt });
    const { default: router } = await import('../../../packages/brain/src/routes/harness-callback.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('lease owner 不匹配 → 409，且日志点名 attempt 与状态码（d9b8a653 之痛）', async () => {
    const res = await request(app)
      .post(`/api/brain/harness/attempts/${ATTEMPT_ID}/callback`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Harness-Lease-Owner', 'someone-else:999')
      .set('X-Harness-Lease-Generation', '0')
      .send({ result: 'completed' });

    expect(res.status).toBe(409);
    const joined = warnings.join('\n');
    expect(joined, '拒绝必须留痕，否则容器 exit=75 后无从排查').toContain(ATTEMPT_ID);
    expect(joined).toContain('409');
    expect(joined).toContain('rejected');
  });

  it('凭据错误 → 401 同样留痕', async () => {
    const res = await request(app)
      .post(`/api/brain/harness/attempts/${ATTEMPT_ID}/callback`)
      .set('Authorization', 'Bearer wrong-token')
      .set('X-Harness-Lease-Owner', LEASE_OWNER)
      .set('X-Harness-Lease-Generation', '0')
      .send({ result: 'completed' });

    expect(res.status).toBe(401);
    expect(warnings.join('\n')).toContain('401');
  });

  it('负向：2xx 成功回执不产生 rejected 日志（不污染故障信号）', async () => {
    mocks.store.recordCallbackTerminal.mockImplementation(async ({ result }) => ({
      attempt: { ...attempt, status: result.status === 'completed' ? 'completed' : 'failed' },
      hop: 5,
      deduped: false,
    }));
    const res = await request(app)
      .post(`/api/brain/harness/attempts/${ATTEMPT_ID}/callback`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('X-Harness-Lease-Owner', LEASE_OWNER)
      .set('X-Harness-Lease-Generation', '0')
      .send({
        contract_version: '1.0',
        attempt_id: ATTEMPT_ID,
        status: 'completed',
        summary: 'ok',
        artifacts: [],
        checks: [{ command: 'npm test', exit_code: 0 }],
        findings: [],
        screenshots: [],
        exploration_notes: ['covered'],
        decision: { outcome: 'PASS', reason: 'ok' },
        error: null,
        provider_metadata: { provider: 'claude', session_id: 's1' },
      });

    expect(res.status).toBeLessThan(400);
    expect(warnings.join('\n')).not.toContain('rejected');
  });
});
