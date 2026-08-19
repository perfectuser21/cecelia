// F1「工厂 · 开发闭环」步骤 1「接单进车间即分档」—— 边：Brain expired-attempt-reconciler ↔ worker attempt-runner
//
// 2026-08-19 生产实证（run 1080c7f5 / attempt 248d96f8）：worker 在 finalize 阶段因 worktree 目录
// Permission denied 把 attempt 置为 quarantined；Brain 的 reconciler 只认识 missing/terminal/
// prepared/running，对 quarantined 落到 worker_attempt_state_unresolved → 每 90s 一次
// infrastructure_blocked → attempt 在 Brain 端永远 running → 单例槽永久被占 →
// 整台机器的 harness 全部 wait:capacity（当晚 r25 的 generator-fix 就是这样被堵住的）。
//
// 本文件按决策 109dd8eb 写在边上：真 attempt-runner（worker 侧 inspect/cancel）+ 真 reconciler，
// 不 mock 两者；只用内存 stateStore 与假 docker（容器在 CI 里起不了）。
import { describe, it, expect, vi } from 'vitest';

import attemptRunnerModule from '../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs';
import { reconcileExpiredAttempt, createExpiredAttemptAuthority } from '../../../packages/brain/src/orchestrator/expired-attempt-reconciler.js';

const { createAttemptRunner } = attemptRunnerModule;

const WORKER_ID = 'us-mac-m4';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const LEASE = Object.freeze({ owner: 'b05597fae1f7:851', generation: 0 });

function inMemoryStateStore(initial = []) {
  const states = new Map(initial.map((e) => [e.attempt_id, { ...e }]));
  return {
    states,
    save: async (entry) => { states.set(entry.attempt_id, { ...entry }); return entry; },
    get: async (id) => states.get(id) ?? null,
    delete: async (id) => states.delete(id),
    list: async () => [...states.values()].map((e) => ({ ...e })),
  };
}

// worker 侧「已 quarantined」的真实持久化形状（照 /var/lib/cecelia/fleet-worker/state/<id>.json）
function quarantinedWorkerState() {
  return {
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    worker_id: WORKER_ID,
    lease_owner: LEASE.owner,
    lease_generation: LEASE.generation,
    role: 'planner',
    status: 'quarantined',
    container_id: 'b66ca35b6439a0f9f2d30fc82731ddf6d813bdd7650a8809251b85e642977510',
    workspace: {
      path: '/Users/Shared/cecelia-fleet-tmp/fleet-mounts/worktrees/' + ATTEMPT_ID,
      admin_path: '/Users/Shared/cecelia-fleet-tmp/fleet-mounts/worktrees/.admin/' + ATTEMPT_ID + '.git',
      mirror_path: '/var/lib/cecelia/fleet-worker/mirrors/perfectuser21__cecelia.git',
      mode: 'read-write',
      owner: { run_id: RUN_ID, attempt_id: ATTEMPT_ID },
    },
    quarantine: {
      status: 'quarantined',
      attempt_id: ATTEMPT_ID,
      reason: "Command failed: git worktree remove --force ...: Permission denied",
    },
    updated_at: '2026-08-19T15:06:07.337Z',
  };
}

function createWorker(stateStore) {
  // quarantined 状态下 inspect/cancel 不会碰 docker；这里的 docker 只为满足构造参数
  const docker = {
    prepare: vi.fn(), start: vi.fn(), wait: vi.fn(), listOwned: vi.fn(async () => []),
    inspect: vi.fn(async () => ({ status: 'missing' })),
    remove: vi.fn(async () => { throw new Error('docker_remove_failed'); }),
  };
  const workspaceManager = {
    prepare: vi.fn(), verify: vi.fn(), reconcile: vi.fn(async () => ({ cleaned_attempts: [] })),
    // 现场的真实情况：清理再次失败（Permission denied 没有自愈），于是又被 quarantine
    cleanup: vi.fn(async () => ({ status: 'quarantined', attempt_id: ATTEMPT_ID, reason: 'Permission denied' })),
    quarantine: vi.fn(async (_w, err) => ({ status: 'quarantined', attempt_id: ATTEMPT_ID, reason: String(err?.message ?? err) })),
  };
  return createAttemptRunner({
    workspaceManager,
    docker,
    stateStore,
    workerId: WORKER_ID,
    runnerImageDigest: `cecelia/runner@sha256:${'a'.repeat(64)}`,
    credentialConsumer: { consume: () => ({}) },
    githubCredentialConsumer: { consume: () => ({}) },
    resourceManager: {
      provision: vi.fn(), release: vi.fn(async () => ({ status: 'released' })),
      releaseService: vi.fn(async () => ({ status: 'released' })), reconcile: vi.fn(async () => ({ removed_attempts: [] })),
    },
  });
}

// Brain 端那条已过期、还挂着 running 的 attempt 行（照 harness_attempts 真实形状）
function brainExpiredAttempt() {
  return {
    id: ATTEMPT_ID,
    run_id: RUN_ID,
    hop: 4,
    role: 'planner',
    status: 'running',
    lease_owner: LEASE.owner,
    lease_generation: LEASE.generation,
    lease_expires_at: '2026-08-19T15:09:02.000Z',
    requested_machine_id: WORKER_ID,
    actual_machine_id: WORKER_ID,
    execution_transport: 'fleet-worker',
    remote_job_id: 'b66ca35b6439a0f9f2d30fc82731ddf6d813bdd7650a8809251b85e642977510',
    machine_attestation_status: 'verified',
    task_bundle: { inputs: { execution_surface: 'fleet-worker' } },
  };
}

describe('F1 step1 接单进车间 — worker quarantined 的过期 attempt 不得永久占槽', () => {
  it('reconciler 对真 worker 的 quarantined 回答：终态化并要求替换，不再 infrastructure_blocked 空转', async () => {
    const stateStore = inMemoryStateStore([quarantinedWorkerState()]);
    const worker = createWorker(stateStore);

    // 生产里 reconciler 经 remote-bridge 调 worker 的 inspect/cancel/start；这里直连同一组方法
    const launcher = {
      inspect: ({ attempt }) => worker.inspect(attempt.id, { owner: attempt.lease_owner, generation: attempt.lease_generation }),
      cancel: ({ attempt }) => worker.cancel(attempt.id, { owner: attempt.lease_owner, generation: attempt.lease_generation }),
      start: ({ attempt }) => worker.start(attempt.id, { owner: attempt.lease_owner, generation: attempt.lease_generation }),
    };
    const terminalize = vi.fn(async (input) => ({
      attempt: { ...brainExpiredAttempt(), status: 'failed', error_code: input.code },
      hop: 18,
      deduped: false,
    }));
    const heartbeat = vi.fn(async () => brainExpiredAttempt());

    // 先核实 worker 真的回答 quarantined（边的一端）
    const inspected = await worker.inspect(ATTEMPT_ID, LEASE);
    expect(inspected.status).toBe('quarantined');

    const result = await reconcileExpiredAttempt({
      attempt: brainExpiredAttempt(),
      launcher,
      attemptStore: { heartbeat },
      terminalize,
      now: () => new Date('2026-08-19T15:31:09.000Z'),
      leaseSeconds: 300,
    });

    // 边的另一端：Brain 必须终态化它，让单例槽释放，kernel 好重派这个角色
    expect(result.status, '不能再是 infrastructure_blocked 空转').toBe('replacement_required');
    expect(terminalize).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: ATTEMPT_ID,
      code: 'worker_attempt_quarantined_after_lease',
    }));
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it('生产 terminalize authority 接受 worker_attempt_quarantined_after_lease（码白名单不能漏）', async () => {
    // authority 先校验码再碰 DB：码不在白名单会直接 throw「terminal code invalid」——
    // 单测 mock 的 terminalize 抓不到这个，必须直击真 authority。
    // 假 pool：锁行返回空 → authority 走 attempt_identity_mismatch 回滚，说明码已过白名单。
    const calls = [];
    const client = {
      query: vi.fn(async (sql) => { calls.push(String(sql)); return { rows: [] }; }),
      release: vi.fn(),
    };
    const pool = { connect: async () => client };
    const authority = createExpiredAttemptAuthority(pool);

    const result = await authority.terminalize({
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      leaseOwner: LEASE.owner,
      leaseGeneration: LEASE.generation,
      code: 'worker_attempt_quarantined_after_lease',
      failureClass: 'infrastructure_blocked',
      machineId: WORKER_ID,
      message: 'test',
    });

    expect(result).toMatchObject({ attempt: null, conflict: 'attempt_identity_mismatch' });
    expect(calls.some((q) => /BEGIN/i.test(q))).toBe(true);
  });
});
