import { describe, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildIndependentRollbackSettlement,
  classifyRollbackRouteState,
  readWorkflowLinksDigest,
  runLeasedRollbackRoutes,
} from '../../../../../scripts/lib/release-run-rollback-worker-runtime.mjs';

const routes = [{
  artifact: 'brain',
  command: '/deploy/scripts/brain-rollback.sh',
  args: ['rollback-aaaaaaaaaaaa'],
  expected_digest: `sha256:${'a'.repeat(64)}`,
  expected_current_digest: `sha256:${'c'.repeat(64)}`,
  readback_kind: 'brain-image',
}];
const targets = [{ artifact_name: 'brain', previous_digest: routes[0].expected_digest }];

describe('leased rollback worker runtime', () => {
  it('settles success only after exact typed readback', async () => {
    const settle = vi.fn(async () => ({}));
    await runLeasedRollbackRoutes({
      routes,
      rollbackTargets: targets,
      claimId: 71,
      generation: 1,
      renew: vi.fn(async () => ({})),
      settle,
      runRoute: vi.fn(async () => ({
        artifact: 'brain',
        observed_digest: routes[0].expected_digest,
      })),
      renewalIntervalMs: 5,
    });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      claim_id: 71,
      generation: 1,
      status: 'succeeded',
      late_effect_risk: false,
      observed_targets: targets,
      observed_readbacks: [{
        artifact: 'brain',
        observed_digest: routes[0].expected_digest,
      }],
      evidence: {
        source: 'release_rollback_worker_terminal',
        readbacks: [{
          artifact: 'brain',
          observed_digest: routes[0].expected_digest,
        }],
      },
    }), {
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ['readback mismatch', async () => ({ artifact: 'brain', observed_digest: `sha256:${'b'.repeat(64)}` }), 'release_rollback_readback_mismatch'],
    ['route failure', async () => { throw new Error('boom'); }, 'release_rollback_route_failed'],
  ])('settles unknown with auditable late-effect risk on %s', async (
    _label,
    runRoute,
    code,
  ) => {
    const settle = vi.fn(async () => ({}));
    await expect(runLeasedRollbackRoutes({
      routes,
      rollbackTargets: targets,
      claimId: 71,
      generation: 1,
      renew: vi.fn(async () => ({})),
      settle,
      runRoute,
    })).rejects.toMatchObject({ code });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unknown',
      late_effect_risk: true,
      evidence: expect.objectContaining({ error_code: code }),
    }));
  });

  it('aborts an active route and settles unknown when the lease is lost', async () => {
    const settle = vi.fn(async () => ({}));
    let renewals = 0;
    const runRoute = vi.fn((_route, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    await expect(runLeasedRollbackRoutes({
      routes,
      rollbackTargets: targets,
      claimId: 71,
      generation: 1,
      renew: vi.fn(async () => {
        renewals += 1;
        if (renewals > 2) throw new Error('fenced');
      }),
      settle,
      runRoute,
      renewalIntervalMs: 1,
    })).rejects.toMatchObject({ code: 'release_rollback_lease_lost' });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unknown',
      late_effect_risk: true,
      evidence: expect.objectContaining({
        error_code: 'release_rollback_lease_lost',
      }),
    }));
  });

  it('fails closed before effect for an invalid runtime contract', async () => {
    const settle = vi.fn();
    await expect(runLeasedRollbackRoutes({
      routes: [],
      rollbackTargets: [],
      claimId: 71,
      generation: 1,
      renew: vi.fn(),
      settle,
      runRoute: vi.fn(),
    })).rejects.toMatchObject({ code: 'release_rollback_worker_contract_invalid' });
    expect(settle).not.toHaveBeenCalled();
  });

  it('preflights the complete artifact set before the first mutation', async () => {
    const runRoute = vi.fn();
    const settle = vi.fn(async () => ({}));
    await expect(runLeasedRollbackRoutes({
      routes,
      rollbackTargets: targets,
      claimId: 71,
      generation: 1,
      renew: vi.fn(async () => ({})),
      settle,
      preflightRoutes: vi.fn(async () => {
        const error = new Error('release_rollback_current_cas_mismatch');
        error.code = 'release_rollback_current_cas_mismatch';
        throw error;
      }),
      runRoute,
    })).rejects.toMatchObject({ code: 'release_rollback_current_cas_mismatch' });
    expect(runRoute).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unknown',
      late_effect_risk: true,
    }));
  });

  it('recognizes a route completed before controller restart without replaying it', () => {
    expect(classifyRollbackRouteState(routes[0], {
      digest: routes[0].expected_digest,
    })).toBe('completed');
    expect(classifyRollbackRouteState(routes[0], {
      digest: routes[0].expected_current_digest,
    })).toBe('pending');
    expect(() => classifyRollbackRouteState(routes[0], {
      digest: `sha256:${'f'.repeat(64)}`,
    })).toThrow('release_rollback_current_cas_mismatch');
  });

  it('uses an independent unknown settlement after a lock-client failure', () => {
    expect(buildIndependentRollbackSettlement({
      claimId: 71,
      generation: 1,
      effectMayHaveStarted: true,
      errorCode: 'release_rollback_lease_lost',
    })).toEqual({
      claim_id: 71,
      generation: 1,
      status: 'unknown',
      late_effect_risk: true,
      evidence: {
        source: 'release_rollback_worker_independent_terminal',
        error_code: 'release_rollback_lease_lost',
      },
    });
  });

  it('preserves late-effect risk when interrupted Workflow WAL recovery fails', async () => {
    const settle = vi.fn(async () => ({}));
    const recoveryError = Object.assign(
      new Error('release_rollback_recovery_failed'),
      { code: 'release_rollback_recovery_failed' },
    );
    await expect(runLeasedRollbackRoutes({
      routes,
      rollbackTargets: targets,
      claimId: 71,
      generation: 1,
      renew: vi.fn(async () => ({})),
      settle,
      preflightRoutes: vi.fn(async () => {
        throw recoveryError;
      }),
      runRoute: vi.fn(),
    })).rejects.toMatchObject({ code: 'release_rollback_recovery_failed' });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unknown',
      late_effect_risk: true,
      evidence: expect.objectContaining({
        error_code: 'release_rollback_recovery_failed',
      }),
    }));
  });

  it('settles an explicit abort with late-effect risk and never reports success', async () => {
    const controller = new AbortController();
    const settle = vi.fn(async () => ({}));
    const runRoute = vi.fn((_route, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const running = runLeasedRollbackRoutes({
      routes,
      rollbackTargets: targets,
      claimId: 71,
      generation: 1,
      renew: vi.fn(async () => ({})),
      settle,
      abortSignal: controller.signal,
      runRoute,
    });
    await vi.waitFor(() => expect(runRoute).toHaveBeenCalledOnce());
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'release_rollback_aborted' });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'aborted',
      late_effect_risk: true,
    }));
    expect(settle).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
    }));
  });

  it('does not report success when abort arrives after the final route readback', async () => {
    const controller = new AbortController();
    const settle = vi.fn(async () => ({}));
    let renewals = 0;
    await expect(runLeasedRollbackRoutes({
      routes,
      rollbackTargets: targets,
      claimId: 71,
      generation: 1,
      renew: vi.fn(async () => {
        renewals += 1;
        if (renewals === 3) controller.abort();
      }),
      settle,
      abortSignal: controller.signal,
      runRoute: vi.fn(async () => ({
        artifact: 'brain',
        observed_digest: routes[0].expected_digest,
      })),
    })).rejects.toMatchObject({ code: 'release_rollback_aborted' });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'aborted',
      late_effect_risk: true,
    }));
    expect(settle).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'succeeded',
    }));
  });

  it('passes the abort fence into success settlement so an in-flight abort cannot commit', async () => {
    const controller = new AbortController();
    const statuses = [];
    const settle = vi.fn(async (settlement, { signal } = {}) => {
      statuses.push(settlement.status);
      if (settlement.status === 'succeeded') {
        controller.abort();
        await Promise.resolve();
        if (signal?.aborted) {
          const error = new Error('release_rollback_aborted');
          error.code = 'release_rollback_aborted';
          throw error;
        }
      }
    });
    await expect(runLeasedRollbackRoutes({
      routes,
      rollbackTargets: targets,
      claimId: 71,
      generation: 1,
      renew: vi.fn(async () => ({})),
      settle,
      abortSignal: controller.signal,
      runRoute: vi.fn(async () => ({
        artifact: 'brain',
        observed_digest: routes[0].expected_digest,
      })),
    })).rejects.toMatchObject({ code: 'release_rollback_aborted' });
    expect(statuses).toEqual(['succeeded', 'aborted']);
  });

  it('derives workflow readback from live symlinks, not manifest bytes alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'rollback-live-links-'));
    try {
      const live = join(root, 'account/skills/example');
      const prior = join(root, 'prior/example');
      const wrong = join(root, 'wrong/example');
      mkdirSync(join(root, 'account/skills'), { recursive: true });
      mkdirSync(prior, { recursive: true });
      mkdirSync(wrong, { recursive: true });
      symlinkSync(prior, live);
      const manifest = join(root, 'links');
      writeFileSync(manifest, `${live}\t${prior}\n`);
      expect(readWorkflowLinksDigest(manifest)).toMatch(/^sha256:[0-9a-f]{64}$/);
      unlinkSync(live);
      symlinkSync(wrong, live);
      expect(() => readWorkflowLinksDigest(manifest))
        .toThrow('release_rollback_workflow_live_readback_mismatch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
