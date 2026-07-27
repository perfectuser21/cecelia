import { beforeAll, describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
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
  await access(CLI);
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

  it('Engine shell 与 stop hook 全量真跑且 skipped=0', async () => {
    const report = await runCli(['--run-engine']);
    expect(report.engine_test_summary).toEqual(
      expect.objectContaining({
        started: true,
        failed: 0,
        skipped: 0,
      }),
    );
    expect(report.required_constructs).toEqual(
      expect.arrayContaining([
        'branch-protect',
        'credential-guard',
        'bash-guard',
        'branch-push-guard',
        'main-repo-write-guard',
        'pre-push',
        'worktree-checkout-guard',
        'stop-router',
        'stop-architect',
        'stop-conversation',
        'stop-decomp',
        'devgate-tdd',
        'devgate-dod',
        'evaluator',
        'judge',
        'staging',
        'promote',
        'rollback',
      ]),
    );
    for (const proof of report.engine_test_summary.proofs as Array<Record<string, any>>) {
      expect(proof).toEqual(
        expect.objectContaining({
          started: true,
          passed: true,
          exit_code: 0,
          log_tail: expect.any(String),
          assertion_ref: expect.any(String),
        }),
      );
    }
  });
});
