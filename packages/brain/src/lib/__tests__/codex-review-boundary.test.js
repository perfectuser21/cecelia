import { describe, expect, it, vi } from 'vitest';
import {
  buildCodexReviewArguments,
  buildCodexReviewDockerArguments,
  buildCodexReviewDockerEnvironment,
  extractCodexReviewBranch,
  extractCodexReviewExpectedRevisions,
  parseCodexReviewVerdict,
  readCodexReviewAuthSnapshot,
  readCodexReviewFile,
  resolveCodexReviewAuthFile,
  resolveCodexReviewGitMetadata,
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

  it('requires task/workspace/CI revision evidence to agree exactly', () => {
    const head = 'a'.repeat(40);
    const base = 'b'.repeat(40);
    expect(extractCodexReviewExpectedRevisions({
      payload: {
        task_bundle: {
          inputs: {
            pull_request: { head_sha: head, base_sha: base },
            workspace: { expected_head_sha: head, base_sha: base },
            ci: { head_sha: head },
          },
        },
      },
    })).toEqual({ headSha: head, baseSha: base });
    expect(() => extractCodexReviewExpectedRevisions({
      payload: {
        task_bundle: {
          inputs: {
            pull_request: { head_sha: head },
            ci: { head_sha: 'c'.repeat(40) },
          },
        },
      },
    })).toThrowError(expect.objectContaining({
      code: 'review_revision_evidence_conflict',
    }));
  });

  it('uses an exact read-only argv and does not expose the prompt in argv', () => {
    const args = buildCodexReviewArguments({
      gitMetadata: {
        worktreeGitDirName: 'cp-safe',
      },
    });
    expect(args).toEqual(expect.arrayContaining([
      'exec',
      '--model',
      'gpt-5.4',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '-c',
      'approval_policy="never"',
      '-',
    ]));
    expect(args).not.toContain('--sandbox');
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

  it('copies auth through one pinned descriptor and rejects metadata drift', () => {
    const metadata = {
      isFile: () => true,
      nlink: 1,
      mode: 0o100600,
      size: 16,
      dev: 1,
      ino: 2,
    };
    const close = vi.fn();
    const snapshot = readCodexReviewAuthSnapshot({
      authFilePath: '/Users/reviewer/.codex-team1/auth.json',
      egressSocketPath: '/review-egress/egress.sock',
      open: () => 17,
      inspect: () => metadata,
      read: () => Buffer.from('{"tokens":"ok"} '),
      close,
    });
    expect(snapshot.toString('utf8')).toBe('{"tokens":"ok"} ');
    expect(close).toHaveBeenCalledWith(17);

    let call = 0;
    expect(() => readCodexReviewAuthSnapshot({
      authFilePath: '/Users/reviewer/.codex-team1/auth.json',
      open: () => 17,
      inspect: () => ({
        ...metadata,
        ino: ++call === 1 ? 2 : 3,
      }),
      read: () => Buffer.from('{"tokens":"ok"} '),
      close: () => {},
    })).toThrowError(expect.objectContaining({
      code: 'review_auth_file_unsafe',
    }));
  });

  it('reads only a bounded regular task card through O_NOFOLLOW', () => {
    const close = vi.fn();
    const open = vi.fn(() => 17);
    expect(readCodexReviewFile({
      worktreePath: '/allowed/cp-safe',
      fileName: '.task-cp-safe.md',
      open,
      inspect: () => ({
        isFile: () => true,
        nlink: 1,
        size: 12,
      }),
      read: (descriptor, encoding) => {
        expect(descriptor).toBe(17);
        expect(encoding).toBe('utf-8');
        return 'trusted card';
      },
      close,
    })).toBe('trusted card');
    expect(open.mock.calls[0][0]).toBe('/allowed/cp-safe/.task-cp-safe.md');
    expect(open.mock.calls[0][1]).toBeGreaterThan(0);
    expect(close).toHaveBeenCalledWith(17);
  });

  it('rejects traversal and unsafe task-card file metadata', () => {
    expect(() => readCodexReviewFile({
      worktreePath: '/allowed/cp-safe',
      fileName: '../auth.json',
    })).toThrowError(expect.objectContaining({
      code: 'review_file_name_invalid',
    }));
    expect(() => readCodexReviewFile({
      worktreePath: '/allowed/cp-safe',
      fileName: '.task-cp-safe.md',
      open: () => 17,
      inspect: () => ({
        isFile: () => true,
        nlink: 2,
        size: 12,
      }),
      read: () => 'forbidden',
      close: () => {},
    })).toThrowError(expect.objectContaining({
      code: 'review_file_unsafe',
    }));
    expect(() => readCodexReviewFile({
      worktreePath: '/allowed/cp-safe',
      fileName: '.task-cp-safe.md',
      open: () => 17,
      inspect: () => ({
        isFile: () => true,
        nlink: 1,
        size: 1,
      }),
      read: () => 'x'.repeat(512 * 1024 + 1),
      close: () => {},
    })).toThrowError(expect.objectContaining({
      code: 'review_file_unsafe',
    }));
  });

  it('pins the review image to an inspected immutable image ID', () => {
    const execute = vi.fn((_command, args) => (
      args.includes('inspect')
        ? `sha256:${'a'.repeat(64)}\n`
        : 'codex-cli 0.145.0\n'
    ));
    expect(resolveCodexReviewImage({
      dockerBin: '/usr/bin/docker',
      execute,
    })).toBe(`sha256:${'a'.repeat(64)}`);
    expect(execute).toHaveBeenNthCalledWith(
      1,
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
    expect(execute).toHaveBeenNthCalledWith(
      2,
      '/usr/bin/docker',
      expect.arrayContaining([
        'run',
        '--network',
        'none',
        `sha256:${'a'.repeat(64)}`,
        '--version',
      ]),
      expect.objectContaining({
        timeout: 30_000,
      }),
    );
  });

  it('admits only the registered worktree gitdir under the exact common .git', () => {
    const execute = vi.fn((_command, args) => {
      if (args.includes('--absolute-git-dir')) return '/repo/.git/worktrees/cp-safe\n';
      if (args.includes('--git-common-dir')) return '/repo/.git\n';
      if (args.includes('--verify') && args.includes('HEAD^{commit}')) return `${'a'.repeat(40)}\n`;
      if (args.includes('--verify') && args.includes('origin/main^{commit}')) return `${'b'.repeat(40)}\n`;
      if (args.includes('merge-base') && !args.includes('--is-ancestor')) return `${'c'.repeat(40)}\n`;
      if (args.includes('merge-base') && args.includes('--is-ancestor')) return '';
      if (args.includes('--porcelain=v1')) return '';
      if (args.includes('ls-tree')) return Buffer.from('tree evidence');
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    });
    expect(resolveCodexReviewGitMetadata({
      worktreePath: '/allowed/cp-safe',
      repoRoot: '/repo',
      execute,
      resolveRealPath: (value) => value,
    })).toEqual({
      commonDir: '/repo/.git',
      worktreeGitDirName: 'cp-safe',
      headSha: 'a'.repeat(40),
      baseSha: 'c'.repeat(40),
      targetBaseSha: 'b'.repeat(40),
      snapshotDigest: '989bb1fc259cd60ec6c5fac8c1ce8e61adaf2134ac3d459d1af3c5823f59f337',
    });

    expect(() => resolveCodexReviewGitMetadata({
      worktreePath: '/allowed/cp-safe',
      repoRoot: '/repo',
      execute: vi.fn((_command, args) => (
        args.includes('--absolute-git-dir')
          ? '/deploy/.git/worktrees/cp-safe\n'
          : '/deploy/.git\n'
      )),
      resolveRealPath: (value) => value,
    })).toThrowError(expect.objectContaining({
      code: 'review_git_metadata_outside_boundary',
    }));
  });

  it('fails closed for a dirty worktree or mutable/non-commit revision evidence', () => {
    const execute = vi.fn((_command, args) => {
      if (args.includes('--absolute-git-dir')) return '/repo/.git/worktrees/cp-safe\n';
      if (args.includes('--git-common-dir')) return '/repo/.git\n';
      if (args.includes('--verify')) return `${'a'.repeat(40)}\n`;
      if (args.includes('merge-base') && !args.includes('--is-ancestor')) return `${'a'.repeat(40)}\n`;
      if (args.includes('merge-base') && args.includes('--is-ancestor')) return '';
      if (args.includes('--porcelain=v1')) return ' M src/unsafe.js\n';
      if (args.includes('ls-tree')) return Buffer.from('tree');
      throw new Error('unexpected');
    });
    expect(() => resolveCodexReviewGitMetadata({
      worktreePath: '/allowed/cp-safe',
      repoRoot: '/repo',
      execute,
      resolveRealPath: (value) => value,
    })).toThrowError(expect.objectContaining({
      code: 'review_worktree_dirty',
    }));
  });

  it('accepts only exact bounded PASS/FAIL JSON and never synthesizes PASS', () => {
    expect(parseCodexReviewVerdict(
      '{"verdict":"PASS","issues":[],"summary":"clean"}',
    )).toEqual({
      verdict: 'PASS',
      issues: [],
      summary: 'clean',
    });
    expect(parseCodexReviewVerdict(
      '{"verdict":"FAIL","summary":"blocker"}',
    )).toEqual({
      verdict: 'FAIL',
      summary: 'blocker',
    });
    for (const invalid of [
      '',
      'looks good',
      '{"summary":"missing"}',
      '{"verdict":"APPROVED","summary":"wrong contract"}',
      '{"verdict":"PASS","summary":""}',
      '{"verdict":"FAIL","summary":"bad","issues":["string issue"]}',
      `{"verdict":"PASS","summary":"${'x'.repeat(4_001)}"}`,
      '{"verdict":"PASS","summary":"ok"} trailing',
    ]) {
      expect(parseCodexReviewVerdict(invalid)).toBeNull();
    }
  });

  it('builds a non-root container from an immutable commit archive without mounting the live worktree', () => {
    const args = buildCodexReviewDockerArguments({
      worktreePath: '/allowed/cp-safe',
      gitMetadata: {
        commonDir: '/repo/.git',
        worktreeGitDirName: 'cp-safe',
        headSha: 'a'.repeat(40),
        baseSha: 'b'.repeat(40),
        targetBaseSha: 'b'.repeat(40),
        snapshotDigest: 'c'.repeat(64),
      },
      authFilePath: '/Users/reviewer/.codex-team1/auth.json',
      egressVolumeName:
        'cecelia-codex-review-egress-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      egressOwnerNonce: 'f'.repeat(32),
      egressExpiresAt: '2099-01-01T00:00:00.000Z',
      imageId: `sha256:${'a'.repeat(64)}`,
      containerName: 'cecelia-codex-review-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    expect(args).toEqual(expect.arrayContaining([
      '--interactive',
      '--name',
      'cecelia-codex-review-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--security-opt',
      'seccomp=unconfined',
      '--no-healthcheck',
      '--label',
      'cecelia.kind=codex-reviewer',
      '--label',
      'cecelia.run_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      '--user',
      '1001:1001',
      '--mount',
      '/workspace:rw,noexec,nosuid,nodev,size=512m,mode=700,uid=1001,gid=1001',
      'type=bind,src=/repo/.git,dst=/review-source-git,readonly',
      'type=bind,src=/Users/reviewer/.codex-team1/auth.json,dst=/run/codex-auth,readonly',
      'type=volume,src=cecelia-codex-review-egress-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,dst=/broker,readonly',
      `sha256:${'a'.repeat(64)}`,
      '--ignore-user-config',
      '-c',
      'default_permissions="review"',
    ]));
    expect(args.join(' ')).not.toMatch(
      /docker\.sock|cecelia-deploy-main|GITHUB_TOKEN|DB_PASSWORD|danger-full-access/,
    );
    expect(args.join(' ')).not.toContain('unshare -Ur true');
    expect(args.join(' ')).toContain('git --git-dir=/review-source-git archive');
    expect(args.join(' ')).toContain(
      `REVIEW_SNAPSHOT_DIGEST=${'c'.repeat(64)}`,
    );
    expect(args.join(' ')).toContain('tar -xf /tmp/codex-review-snapshot.tar -C /workspace');
    expect(args.join(' ')).not.toContain('src=/allowed/cp-safe');
    expect(args.join(' ')).toContain('"/home/cecelia/.codex" = "deny"');
    expect(args.join(' ')).toContain('"/run/codex-auth" = "deny"');
    expect(args.join(' ')).toContain('"/broker" = "deny"');
    expect(args.join(' ')).toContain('--network none');
    expect(args.join(' ')).toContain('HTTPS_PROXY=http://127.0.0.1:3128');
    expect(args.join(' ')).toContain('"/review-source-git" = "deny"');
    expect(args.join(' ')).toContain(`REVIEW_HEAD=${'a'.repeat(40)}`);
    expect(args.join(' ')).not.toContain('--sandbox read-only');
    expect(Object.isFrozen(args)).toBe(true);
  });
});
