import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'packages/engine/scripts/legacy-equivalence-gate.mjs');

async function runCli(args: string[]): Promise<Record<string, any>> {
  const dir = await mkdtemp(path.join(tmpdir(), 'legacy-equivalence-integration-'));
  const output = path.join(dir, 'report.json');
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, '--repo-root', REPO_ROOT, ...args, '--output', output],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 600_000,
        env: { ...process.env, TARGET_ENVIRONMENT: 'local_api' },
      },
    );
    expect(
      result.status,
      `CLI 失败\nstdout=${result.stdout ?? ''}\nstderr=${result.stderr ?? ''}`,
    ).toBe(0);
    return JSON.parse(await readFile(output, 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  const auth = spawnSync('gh', ['auth', 'status'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(auth.status, 'GitHub 真验需要有效 gh 凭据；不可用必须 FAIL，不得 skip').toBe(0);
});

describe('Legacy equivalence real seams', () => {
  it('GitHub main protection 真实只读 API 校验 required checks/admin/linear/force/delete/review policy', async () => {
    const live = spawnSync(
      'gh',
      ['api', 'repos/perfectuser21/cecelia/branches/main/protection'],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 },
    );
    expect(live.status, `gh api 必须成功: ${live.stderr ?? ''}`).toBe(0);
    const protection = JSON.parse(live.stdout);
    expect(protection.required_status_checks.contexts).toEqual(expect.any(Array));
    expect(protection.enforce_admins.enabled).toEqual(expect.any(Boolean));
    expect(protection.required_pull_request_reviews).toEqual(expect.any(Object));
    expect(protection.required_linear_history.enabled).toEqual(expect.any(Boolean));
    expect(protection.allow_force_pushes.enabled).toEqual(expect.any(Boolean));
    expect(protection.allow_deletions.enabled).toEqual(expect.any(Boolean));

    const report = await runCli([
      '--verify-github-protection',
      'perfectuser21/cecelia',
      'main',
    ]);
    expect(report.github_protection).toEqual(
      expect.objectContaining({
        requested_live: true,
        match: true,
      }),
    );
    expect(report.github_protection.observed).toEqual(
      expect.objectContaining({
        required_status_checks: expect.any(Object),
        enforce_admins: expect.any(Object),
        required_pull_request_reviews: expect.any(Object),
        required_linear_history: expect.any(Object),
        allow_force_pushes: expect.any(Object),
        allow_deletions: expect.any(Object),
      }),
    );
  });

  it('Engine required construct 与 stop route 精确集合真跑且 skipped=0', async () => {
    const report = await runCli(['--run-engine']);
    const requiredConstructs = [
      'bash-guard',
      'branch-protect',
      'branch-push-guard',
      'credential-guard',
      'devgate-dod',
      'devgate-tdd',
      'evaluator',
      'github-branch-protection',
      'judge',
      'main-repo-write-guard',
      'pre-push',
      'promote',
      'rollback',
      'staging',
      'stop-architect',
      'stop-conversation',
      'stop-decomp',
      'stop-router',
      'worktree-checkout-guard',
    ].sort();
    const stopHooks = ['stop-architect', 'stop-conversation', 'stop-decomp'].sort();
    expect(report.engine_test_summary).toEqual(
      expect.objectContaining({
        started: true,
        failed: 0,
        skipped: 0,
      }),
    );
    expect([...report.required_constructs].sort()).toEqual(requiredConstructs);
    expect([...report.discovered_stop_hooks].sort()).toEqual(stopHooks);
    expect([...report.routed_stop_hooks].sort()).toEqual(stopHooks);
    expect([...report.proven_stop_hooks].sort()).toEqual(stopHooks);

    const proofs = report.required_construct_proofs as Array<Record<string, any>>;
    expect(proofs.map((proof) => proof.construct).sort()).toEqual(requiredConstructs);
    expect(new Set(proofs.map((proof) => proof.construct)).size).toBe(requiredConstructs.length);
    for (const proof of proofs) {
      expect(proof.behavior_ids.length, `${proof.construct} 必须关联 behavior_id`).toBeGreaterThan(0);
      for (const phase of ['positive', 'violation', 'recovery']) {
        expect(proof.oracles[phase]).toEqual(
          expect.objectContaining({
            started: true,
            passed: true,
            exit_code: expect.any(Number),
            log_tail: expect.any(String),
            assertion_ref: expect.any(String),
          }),
        );
      }
    }
  });
});
