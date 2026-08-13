// RED baseline (proposer) — RED-3 / RED-6.
// 证明当前 reconcileExpiredAttempt 对 inspect.status='quarantined' 落到末尾
// worker_attempt_state_unresolved(infrastructure_blocked) 分支：既不 terminalize、
// 也不允许 replacement，loop 反复 deny，run 永久卡 generate。
// 修复后：quarantined 是确定终态 —— 用专属 error_code
// `worker_attempt_quarantined_terminalized` 一次事务标 failed + 写 append-only
// evidence，并返回 loop 可推进的 replacement_required（derive 生成 fresh replacement）。
//
// 该测试只钉住"分支路由 + 专属 code"（可独立运行）。真实 PostgreSQL 单事务
// failed+evidence+replacement 与幂等回归见 ## 禁 mock 边清单 指定的 .pg.integration。

import { describe, expect, it, vi } from 'vitest';
import { reconcileExpiredAttempt } from '../../../packages/brain/src/orchestrator/expired-attempt-reconciler.js';

const NOW = new Date('2026-08-13T21:29:30.000Z');
const QUARANTINED_ATTEMPT = Object.freeze({
  id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
  run_id: '92a67d1a-2c3a-4819-9930-09d841f31bd8',
  hop: 13,
  phase: 'gan',
  role: 'generator',
  status: 'running',
  lease_owner: 'controller-old:5531',
  lease_generation: 0,
  lease_expires_at: '2026-08-13T21:28:00.000Z', // 已过期
  requested_machine_id: 'us-mac-m4',
  actual_machine_id: 'us-mac-m4',
  execution_transport: 'fleet-worker',
  remote_job_id: '863fdc22-ad3e-4e89-a8ce-6323cf9b9917',
  machine_attestation_status: 'verified',
  task_bundle: { inputs: { execution_surface: 'fleet-worker' } },
});

function makeDeps(inspectStatus) {
  const terminalize = vi.fn(async (input) => ({
    attempt: { ...QUARANTINED_ATTEMPT, status: 'failed', error_code: input.code },
    hop: 14,
    deduped: false,
  }));
  return {
    now: () => NOW,
    launcher: {
      // 生产复现：容器被另一实例 docker rm，Worker inspect 回 quarantined。
      inspect: vi.fn(async () => ({
        status: inspectStatus,
        attempt_id: QUARANTINED_ATTEMPT.id,
        container_id: QUARANTINED_ATTEMPT.remote_job_id,
      })),
      start: vi.fn(async () => ({ status: 'running', attempt_id: QUARANTINED_ATTEMPT.id })),
      cancel: vi.fn(async () => ({ status: 'cleaned', attempt_id: QUARANTINED_ATTEMPT.id })),
    },
    attemptStore: { heartbeat: vi.fn(async () => ({ ...QUARANTINED_ATTEMPT })) },
    terminalize,
  };
}

describe('reconcileExpiredAttempt quarantined 确定终态 [BEHAVIOR][RED]', () => {
  it('RED-3: quarantined 必须 terminalize（专属 error_code），不得留在 unresolved deny', async () => {
    const deps = makeDeps('quarantined');
    const result = await reconcileExpiredAttempt({ attempt: QUARANTINED_ATTEMPT, ...deps });

    // 修复前：返回 infrastructure_blocked / signature=worker_attempt_state_unresolved。
    expect(result.status).not.toBe('infrastructure_blocked');
    expect(result.signature).not.toBe('worker_attempt_state_unresolved');
    // 专属 error_code 一次事务标 failed。
    expect(deps.terminalize).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'worker_attempt_quarantined_terminalized' }),
    );
  });

  it('RED-6: quarantined 返回 loop 可推进的 replacement_required（允许 derive replacement）', async () => {
    const deps = makeDeps('quarantined');
    const result = await reconcileExpiredAttempt({ attempt: QUARANTINED_ATTEMPT, ...deps });

    // loop.js 只对 missing_terminalized / replacement_required 推进并让 derive 生成 replacement。
    expect(['replacement_required', 'missing_terminalized']).toContain(result.status);
  });
});
