import { describe, expect, it, vi } from 'vitest';
import {
  buildCodexReviewArguments,
  buildCodexReviewDockerArguments,
  buildCodexReviewDockerEnvironment,
  extractCodexReviewBranch,
  resolveCodexReviewAuthFile,
  resolveCodexReviewImage,
  resolveCodexReviewWorktree,
} from '../codex-review-boundary.js';

describe('Codex review process boundary', () => {
  it('resolves only an exact registered branch under an allowed worktree root', () => {
    const execute = vi.fn((command, args) => {
      expect(command).toBe('git');
      if (args.includes('worktree')) {
        return [
          'worktree /repo',
          'branch refs/heads/main',
          '',
          'worktree /allowed/cp-safe',
          'branch refs/heads/cp-safe',
          '',
          'worktree /allowed/cp-safe-extra',
          'branch refs/heads/cp-safe-extra',
          '',
        ].join('\n');
      }
      return '/allowed/cp-safe\n';
    });
    const resolveRealPath = vi.fn((value) => value);

    expect(resolveCodexReviewWorktree({
      branch: 'cp-safe',
      repoRoot: '/repo',
      allowedRoots: ['/allowed'],
      execute,
      resolveRealPath,
    })).toBe('/allowed/cp-safe');
  });

  it.each([
    ['substring branch', 'cp-safe', [
      'worktree /allowed/cp-safe-extra',
      'branch refs/heads/cp-safe-extra',
      '',
    ].join('\n'), 'review_worktree_unavailable'],
    ['main worktree', 'main', [
      'worktree /repo',
      'branch refs/heads/main',
      '',
    ].join('\n'), 'review_worktree_outside_boundary'],
    ['outside root', 'cp-safe', [
      'worktree /deploy/cp-safe',
      'branch refs/heads/cp-safe',
      '',
    ].join('\n'), 'review_worktree_outside_boundary'],
  ])('fails closed for %s', (_label, branch, listing, code) => {
    const execute = vi.fn((_command, args) => (
      args.includes('worktree') ? listing : `${listing.split('\n')[0].slice(9)}\n`
    ));

    expect(() => resolveCodexReviewWorktree({
      branch,
      repoRoot: '/repo',
      allowedRoots: ['/allowed'],
      execute,
      resolveRealPath: (value) => value,
    })).toThrowError(expect.objectContaining({ code }));
  });

  it('extracts explicit branch metadata and rejects shell/ref ambiguity', () => {
    expect(extractCodexReviewBranch({
      metadata: { branch: 'cp-review-safe' },
      title: 'ignored',
    })).toBe('cp-review-safe');
    expect(() => extractCodexReviewBranch({
      metadata: { branch: 'cp-safe..other' },
    })).toThrowError(expect.objectContaining({
      code: 'review_branch_invalid',
    }));
  });

  it('uses an exact read-only argv and does not expose the prompt in argv', () => {
    expect(buildCodexReviewArguments()).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '-c',
      'approval_policy="never"',
      '-',
    ]);
  });

  it('passes only Docker client transport fields and strips Brain credentials', () => {
    const environment = buildCodexReviewDockerEnvironment({
      PATH: '/usr/bin',
      HOME: '/Users/brain',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      GITHUB_TOKEN: 'forbidden',
      DB_PASSWORD: 'forbidden',
      HARNESS_REVIEW_APPROVER_TOKEN: 'forbidden',
      KERNEL_FLEET_BRIDGE_TOKEN: 'forbidden',
      OPENAI_API_KEY: 'forbidden',
    });

    expect(environment).toEqual({
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      HOME: '/nonexistent',
      TMPDIR: '/tmp',
    });
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('accepts only a private, direct auth file from a bounded Codex account home', () => {
    const inspect = vi.fn(() => ({
      isSymbolicLink: () => false,
      isFile: () => true,
      nlink: 1,
      mode: 0o100600,
    }));
    expect(resolveCodexReviewAuthFile({
      codexHome: '/Users/reviewer/.codex-team1',
      resolveRealPath: (value) => value,
      inspect,
    })).toBe('/Users/reviewer/.codex-team1/auth.json');

    expect(() => resolveCodexReviewAuthFile({
      codexHome: '/Users/reviewer/.codex',
      resolveRealPath: (value) => value,
      inspect,
    })).toThrowError(expect.objectContaining({
      code: 'review_auth_home_outside_boundary',
    }));
  });

  it('rejects symlinked, multiply-linked, or broadly-readable auth files', () => {
    for (const metadata of [
      {
        isSymbolicLink: () => true,
        isFile: () => true,
        nlink: 1,
        mode: 0o100600,
      },
      {
        isSymbolicLink: () => false,
        isFile: () => true,
        nlink: 2,
        mode: 0o100600,
      },
      {
        isSymbolicLink: () => false,
        isFile: () => true,
        nlink: 1,
        mode: 0o100644,
      },
    ]) {
      expect(() => resolveCodexReviewAuthFile({
        codexHome: '/Users/reviewer/.codex-team1',
        resolveRealPath: (value) => value,
        inspect: () => metadata,
      })).toThrowError(expect.objectContaining({
        code: 'review_auth_file_unsafe',
      }));
    }
  });

  it('pins the review image to an inspected immutable image ID', () => {
    const execute = vi.fn(() => `sha256:${'a'.repeat(64)}\n`);
    expect(resolveCodexReviewImage({
      dockerBin: '/usr/bin/docker',
      execute,
    })).toBe(`sha256:${'a'.repeat(64)}`);
    expect(execute).toHaveBeenCalledWith(
      '/usr/bin/docker',
      ['image', 'inspect', '--format', '{{.Id}}', 'cecelia-brain:latest'],
      expect.objectContaining({
        env: {
          HOME: '/nonexistent',
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          TMPDIR: '/tmp',
        },
      }),
    );
  });

  it('builds a non-root container with only worktree and one auth mount', () => {
    const args = buildCodexReviewDockerArguments({
      worktreePath: '/allowed/cp-safe',
      authFilePath: '/Users/reviewer/.codex-team1/auth.json',
      imageId: `sha256:${'a'.repeat(64)}`,
    });
    expect(args).toEqual(expect.arrayContaining([
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user',
      '1001:1001',
      '--mount',
      'type=bind,src=/allowed/cp-safe,dst=/workspace,readonly',
      'type=bind,src=/Users/reviewer/.codex-team1/auth.json,dst=/run/codex-auth,readonly',
      `sha256:${'a'.repeat(64)}`,
      '--sandbox',
      'read-only',
    ]));
    expect(args.join(' ')).not.toMatch(
      /docker\.sock|cecelia-deploy-main|GITHUB_TOKEN|DB_PASSWORD|danger-full-access/,
    );
    expect(Object.isFrozen(args)).toBe(true);
  });
});
