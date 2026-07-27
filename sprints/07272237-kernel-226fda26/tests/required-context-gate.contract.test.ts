import { describe, expect, it } from 'vitest';

describe('kernel target-aware required-context gate contract [BEHAVIOR]', () => {
  it('server-owned facts derive target_environment and required contexts', async () => {
    const mod: any = await import('../../../packages/brain/src/orchestrator/ground-truth.js');
    expect(typeof mod.collectKernelReleaseGateTruth).toBe('function');
    const result = mod.collectKernelReleaseGateTruth({
      serverTask: { id: 'task-1', payload: { target_environment: 'local_api' } },
      serverRun: { id: 'run-1', pr_url: 'https://github.com/perfectuser21/cecelia/pull/4226' },
      serverPr: { base_repo: 'cecelia', head_sha: 'sha-current' },
      callerInput: {
        expected_repo: 'evil-repo',
        expected_run: 'evil-run',
        role: 'evil-role',
        target_environment: 'windows_cloud',
      },
    });
    expect(result).toMatchObject({
      base_repo: 'cecelia',
      target_environment: 'local_api',
      current_head_sha: 'sha-current',
    });
    expect(result.authority_source).toBe('server_owned');
    expect(result.required_contexts.length).toBeGreaterThan(0);
  });

  it('independent blocker reasons stay exact', async () => {
    const mod: any = await import('../../../packages/brain/src/orchestrator/gates.js');
    expect(typeof mod.evaluateRequiredContextsForCurrentSha).toBe('function');

    const cases = [
      [{ kind: 'stale_sha' }, 'stale_check_sha'],
      [{ kind: 'wrong_repo' }, 'wrong_repo'],
      [{ kind: 'wrong_run_task' }, 'wrong_run_or_task'],
      [{ kind: 'missing_context' }, 'missing_required_context'],
      [{ kind: 'preview_required_failed' }, 'preview_required_failed'],
      [{ kind: 'local_required_failed' }, 'local_required_context_failed'],
      [{ kind: 'mapping_missing' }, 'required_context_mapping_missing'],
      [{ kind: 'external_failure' }, 'external_infrastructure_failure'],
    ] as const;

    for (const [input, expectedReason] of cases) {
      const result = mod.evaluateRequiredContextsForCurrentSha({
        current_head_sha: 'sha-current',
        target_environment: 'local_api',
        scenario: input.kind,
      });
      expect(result.allow).toBe(false);
      expect(result.reason).toBe(expectedReason);
    }
  });

  it('local_api preview neutral only after local contexts pass', async () => {
    const mod: any = await import('../../../packages/brain/src/orchestrator/gates.js');
    expect(typeof mod.evaluateRequiredContextsForCurrentSha).toBe('function');

    const pass = mod.evaluateRequiredContextsForCurrentSha({
      current_head_sha: 'sha-current',
      target_environment: 'local_api',
      preview_dependency: false,
      required_contexts: [
        { name: 'unit', status: 'PASS', tested_sha: 'sha-current', locality: 'local' },
      ],
    });
    expect(pass.allow).toBe(true);
    expect(pass.preview_status).toBe('neutral');

    const fail = mod.evaluateRequiredContextsForCurrentSha({
      current_head_sha: 'sha-current',
      target_environment: 'local_api',
      preview_dependency: false,
      required_contexts: [
        { name: 'unit', status: 'FAIL', tested_sha: 'sha-current', locality: 'local' },
      ],
    });
    expect(fail.allow).toBe(false);
    expect(fail.reason).toBe('local_required_context_failed');
  });

  it('preview-dependent targets hard fail without preview', async () => {
    const mod: any = await import('../../../packages/brain/src/orchestrator/gates.js');
    expect(typeof mod.evaluateRequiredContextsForCurrentSha).toBe('function');

    const missing = mod.evaluateRequiredContextsForCurrentSha({
      current_head_sha: 'sha-current',
      target_environment: 'windows_cloud',
      preview_dependency: true,
      preview: null,
      required_contexts: [],
    });
    expect(missing.allow).toBe(false);
    expect(missing.reason).toBe('preview_required_missing');

    const failed = mod.evaluateRequiredContextsForCurrentSha({
      current_head_sha: 'sha-current',
      target_environment: 'windows_cloud',
      preview_dependency: true,
      preview: { status: 'FAIL', tested_sha: 'sha-current' },
      required_contexts: [],
    });
    expect(failed.allow).toBe(false);
    expect(failed.reason).toBe('preview_required_failed');
  });

  it('legacy rollout stays explicit and does not weaken target-aware semantics', async () => {
    const mod: any = await import('../../../packages/brain/src/orchestrator/gates.js');
    expect(typeof mod.evaluateRequiredContextsForCurrentSha).toBe('function');
    const result = mod.evaluateRequiredContextsForCurrentSha({
      current_head_sha: 'sha-current',
      target_environment: 'local_api',
      legacy_rollout: true,
      preview_dependency: false,
      required_contexts: [
        { name: 'unit', status: 'FAIL', tested_sha: 'sha-current', locality: 'local' },
      ],
    });
    expect(result.allow).toBe(false);
    expect(result.reason).toBe('local_required_context_failed');
    expect(result.legacy_rollout_applied).toBe(true);
  });
});
