import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const execFileSyncMock = vi.fn();
const accessMock = vi.fn();
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();
const mkdtempMock = vi.fn();
const openMock = vi.fn();
const renameMock = vi.fn();
const unlinkSyncMock = vi.fn();
const rmMock = vi.fn();
const startEgressMock = vi.fn();
const cleanupEgressMock = vi.fn();
const reapEgressMock = vi.fn();
const dbQueryMock = vi.fn(async () => ({
  rows: [{ id: 'review-task' }],
  rowCount: 1,
}));
const resolveWorktreeMock = vi.fn(() => '/allowed/cp-safe-review');
const readReviewFileMock = vi.fn(() => 'trusted task card');
const readFileSyncMock = vi.fn(() => {
  throw Object.assign(new Error('not found'), { code: 'ENOENT' });
});

vi.mock('child_process', () => ({
  spawn: (...args) => spawnMock(...args),
  execFileSync: (...args) => execFileSyncMock(...args),
  execSync: vi.fn(() => ''),
  exec: vi.fn(),
}));
vi.mock('fs/promises', () => ({
  access: (...args) => accessMock(...args),
  mkdir: (...args) => mkdirMock(...args),
  mkdtemp: (...args) => mkdtempMock(...args),
  open: (...args) => openMock(...args),
  rename: (...args) => renameMock(...args),
  rm: (...args) => rmMock(...args),
  writeFile: (...args) => writeFileMock(...args),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFileSync: (...args) => readFileSyncMock(...args),
    readdirSync: vi.fn(() => []),
    unlinkSync: (...args) => unlinkSyncMock(...args),
  };
});
vi.mock('../db.js', () => ({
  default: {
    query: (...args) => dbQueryMock(...args),
  },
}));
vi.mock('../decisions-context.js', () => ({
  getDecisionsSummary: vi.fn(async () => ''),
}));
vi.mock('../harness-shared.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadSkillContent: vi.fn((name) => `TRUSTED SKILL CONTRACT: ${name}`),
  };
});
vi.mock('../lib/codex-review-boundary.js', () => ({
  extractCodexReviewBranch: vi.fn(() => 'cp-safe-review'),
  extractCodexReviewExpectedRevisions: vi.fn(() => ({
    headSha: null,
    baseSha: null,
  })),
  resolveCodexReviewWorktree: (...args) => resolveWorktreeMock(...args),
  readCodexReviewFile: (...args) => readReviewFileMock(...args),
  resolveCodexReviewAuthFile: vi.fn(() => '/review-auth/auth.json'),
  readCodexReviewAuthSnapshot: vi.fn(() => Buffer.from('{"tokens":"safe"}')),
  resolveCodexReviewGitMetadata: vi.fn(() => ({
    commonDir: '/repo/.git',
    worktreeGitDirName: 'cp-safe-review',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    targetBaseSha: 'b'.repeat(40),
    snapshotDigest: 'c'.repeat(64),
  })),
  resolveCodexReviewImage: vi.fn(() => `sha256:${'a'.repeat(64)}`),
  parseCodexReviewVerdict: vi.fn((output) => {
    try {
      const parsed = JSON.parse(output);
      return ['PASS', 'FAIL'].includes(parsed.verdict) ? parsed : null;
    } catch {
      return null;
    }
  }),
  buildCodexReviewDockerArguments: vi.fn(() => [
    'run',
    '--rm',
    '--network',
    'none',
    '--interactive',
    '--read-only',
    '--cap-drop=ALL',
    '--user',
    '1001:1001',
    '--mount',
    'type=bind,src=/repo/.git,dst=/review-source-git,readonly',
    '--mount',
    'type=bind,src=/review-auth/auth.json,dst=/run/codex-auth,readonly',
    '--mount',
    'type=volume,src=cecelia-codex-review-egress-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,dst=/broker,readonly',
    `sha256:${'a'.repeat(64)}`,
    'codex-review',
  ]),
  buildCodexReviewDockerEnvironment: vi.fn(() => Object.freeze({
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/nonexistent',
    TMPDIR: '/tmp',
  })),
}));
vi.mock('../lib/codex-review-egress-runtime.js', () => ({
  startCodexReviewEgress: (...args) => startEgressMock(...args),
  cleanupCodexReviewEgress: (...args) => cleanupEgressMock(...args),
  reapExpiredCodexReviewEgress: (...args) => reapEgressMock(...args),
}));

function childFixture() {
  const child = new EventEmitter();
  child.pid = 1234;
  child.stdin = { end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = vi.fn();
  return child;
}

describe('triggerCodexReview process boundary', () => {
  let triggerCodexReview;
  let reclaimStaleCodexReviewSlot;
  let child;
  let fetchMock;
  let teardownEgressMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    child = childFixture();
    execFileSyncMock.mockReturnValue('trusted task card');
    spawnMock.mockReturnValue(child);
    resolveWorktreeMock.mockReturnValue('/allowed/cp-safe-review');
    rmMock.mockResolvedValue();
    openMock.mockResolvedValue({
      sync: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    });
    renameMock.mockResolvedValue();
    cleanupEgressMock.mockResolvedValue();
    reapEgressMock.mockResolvedValue({ scanned: 0, reaped: 0, pending: 0 });
    dbQueryMock.mockResolvedValue({
      rows: [{ id: 'review-task' }],
      rowCount: 1,
    });
    teardownEgressMock = vi.fn(async () => {});
    startEgressMock.mockResolvedValue({
      brokerContainerName:
        'cecelia-codex-review-broker-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      egressVolumeName:
        'cecelia-codex-review-egress-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      expiresAt: '2099-01-01T00:00:00.000Z',
      ownerNonce: 'f'.repeat(32),
      teardown: teardownEgressMock,
    });
    mkdtempMock.mockResolvedValue(
      '/tmp/cecelia-prompts/codex-review-auth/review-stage',
    );
    fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    ({
      triggerCodexReview,
      _reclaimStaleCodexReviewSlot: reclaimStaleCodexReviewSlot,
    } = await import('../executor.js'));
  });

  it('spawns only a minimal read-only review container with scrubbed client env', async () => {
    const result = await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'spec_review',
      metadata: { branch: 'cp-safe-review' },
      description: 'review only',
    });

    expect(result.success).toBe(true);
    expect(accessMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--interactive',
        '--read-only',
        '--cap-drop=ALL',
        '--user',
        '1001:1001',
        '--mount',
        'type=bind,src=/repo/.git,dst=/review-source-git,readonly',
        '--mount',
        'type=bind,src=/review-auth/auth.json,dst=/run/codex-auth,readonly',
        '--mount',
        'type=volume,src=cecelia-codex-review-egress-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,dst=/broker,readonly',
        `sha256:${'a'.repeat(64)}`,
        'codex-review',
      ],
      {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/',
        env: {
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          HOME: '/nonexistent',
          TMPDIR: '/tmp',
        },
      },
    );
    expect(child.stdin.end).toHaveBeenCalledWith(
      expect.stringContaining('trusted task card'),
    );
    expect(startEgressMock).toHaveBeenCalledWith({
      dockerBin: expect.any(String),
      imageId: `sha256:${'a'.repeat(64)}`,
      runId: expect.stringMatching(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      ),
    });
    expect(child.stdin.end).toHaveBeenCalledWith(
      expect.stringContaining('TRUSTED SKILL CONTRACT: spec-review'),
    );
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'git',
      [
        '-C',
        '/allowed/cp-safe-review',
        'show',
        `${'a'.repeat(40)}:.task-cp-safe-review.md`,
      ],
      expect.objectContaining({
        encoding: 'utf-8',
        maxBuffer: 512 * 1024,
      }),
    );
  });

  it('builds code review diff from the exact admitted worktree without a shell', async () => {
    execFileSyncMock.mockReturnValueOnce('diff --git a/a.js b/a.js\n');
    await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'code_review_gate',
      metadata: { branch: 'cp-safe-review' },
      description: 'review code',
    });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      'git',
      [
        '-C',
        '/allowed/cp-safe-review',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        `${'b'.repeat(40)}..${'a'.repeat(40)}`,
      ],
      expect.objectContaining({
        encoding: 'utf-8',
        timeout: 15_000,
      }),
    );
    expect(child.stdin.end).toHaveBeenCalledWith(
      expect.stringContaining('diff --git a/a.js b/a.js'),
    );
  });

  it('maps a slash branch to one committed task-card filename', async () => {
    await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'spec_review',
      metadata: { branch: 'feature/safe-review' },
      description: 'review only',
    });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      'git',
      [
        '-C',
        '/allowed/cp-safe-review',
        'show',
        `${'a'.repeat(40)}:.task-feature-safe-review.md`,
      ],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('reports a non-zero Codex exit as AI Failed', async () => {
    await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'spec_review',
      metadata: { branch: 'cp-safe-review' },
      description: 'review only',
    });
    child.stderr.emit('data', Buffer.from('review failed'));
    child.emit('exit', 17);
    await vi.waitFor(() => {
      expect(dbQueryMock).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO callback_queue'),
        expect.any(Array),
      );
    });
    expect(teardownEgressMock).toHaveBeenCalledTimes(1);
    expect(teardownEgressMock).toHaveBeenCalledWith(
      expect.stringMatching(/^cecelia-codex-review-[a-f0-9-]{36}$/),
    );

    const callback = dbQueryMock.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO callback_queue')
    ));
    expect(callback[1][2]).toBe('AI Failed');
    expect(JSON.parse(callback[1][3])).toMatchObject({
      verdict: 'FAIL',
      summary: 'review failed',
      _meta: { coding_type: 'codex-review' },
    });
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('terminal.json.tmp'),
      expect.stringContaining('"status":"AI Failed"'),
      { mode: 0o600, flag: 'w' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports exit zero without exact structured verdict as AI Failed', async () => {
    await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'spec_review',
      metadata: { branch: 'cp-safe-review' },
      description: 'review only',
    });
    child.stdout.emit('data', Buffer.from('looks good'));
    child.emit('exit', 0);
    await vi.waitFor(() => expect(dbQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO callback_queue'),
      expect.any(Array),
    ));

    const callback = dbQueryMock.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO callback_queue')
    ));
    expect(callback[1][2]).toBe('AI Failed');
    expect(JSON.parse(callback[1][3])).toMatchObject({
      verdict: 'FAIL',
      summary: 'invalid_or_missing_review_verdict',
    });
  });

  it('persists an exact FAIL verdict as completed review work, never PASS', async () => {
    await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'code_review_gate',
      metadata: { branch: 'cp-safe-review' },
      description: 'review only',
    });
    child.stdout.emit('data', Buffer.from(
      '{"verdict":"FAIL","issues":[],"summary":"blocker found"}',
    ));
    child.emit('exit', 0);
    await vi.waitFor(() => expect(dbQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO callback_queue'),
      expect.any(Array),
    ));

    const callback = dbQueryMock.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO callback_queue')
    ));
    expect(callback[1][2]).toBe('AI Done');
    expect(JSON.parse(callback[1][3])).toMatchObject({
      verdict: 'FAIL',
      summary: 'blocker found',
    });
  });

  it('synthesizes a durable FAIL before reclaiming a dead reviewer without terminal.json', async () => {
    readFileSyncMock.mockImplementation((filePath) => {
      if (String(filePath).endsWith('/info.json')) {
        return JSON.stringify({
          taskId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          runId: '11111111-2222-4333-8444-555555555555',
          containerName:
            'cecelia-codex-review-11111111-2222-4333-8444-555555555555',
          startedAt: '2026-07-28T00:00:00.000Z',
          reviewEvidence: {
            contract_version: 'kernel-codex-review-evidence/v1',
          },
        });
      }
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    });
    execFileSyncMock.mockImplementation(() => {
      const error = new Error('No such container');
      error.stderr = 'Error: No such object';
      throw error;
    });

    await expect(reclaimStaleCodexReviewSlot(
      '/persistent/.kernel-codex-review-locks/slot-1',
      '/usr/local/bin/docker',
    )).resolves.toBe(true);

    const callback = dbQueryMock.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO callback_queue')
    ));
    expect(callback).toBeTruthy();
    expect(callback[1][2]).toBe('AI Failed');
    expect(JSON.parse(callback[1][3])).toMatchObject({
      verdict: 'FAIL',
      summary: 'reviewer_exit_without_terminal',
      review_evidence: {
        contract_version: 'kernel-codex-review-evidence/v1',
      },
    });
    expect(rmMock).toHaveBeenCalledWith(
      '/persistent/.kernel-codex-review-locks/slot-1',
      { recursive: true, force: true },
    );
  });

  it('does not allocate a slot or spawn when the exact worktree is unavailable', async () => {
    resolveWorktreeMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('unavailable'), {
        code: 'review_worktree_unavailable',
      });
    });

    const result = await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'spec_review',
      metadata: { branch: 'cp-missing' },
    });

    expect(result).toMatchObject({
      success: false,
      configError: true,
      reason: 'review_worktree_unavailable',
    });
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(startEgressMock).not.toHaveBeenCalled();
  });

  it('does not allocate a slot or spawn when the container runtime is unavailable', async () => {
    accessMock.mockRejectedValueOnce(
      Object.assign(new Error('not executable'), { code: 'EACCES' }),
    );

    const result = await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'spec_review',
      metadata: { branch: 'cp-safe-review' },
    });

    expect(result).toMatchObject({
      success: false,
      configError: true,
      reason: 'review_container_runtime_missing',
    });
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails closed and never spawns a reviewer when its egress sidecar cannot start', async () => {
    startEgressMock.mockRejectedValueOnce(
      new Error('review_egress_broker_not_ready'),
    );

    const result = await triggerCodexReview({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'spec_review',
      metadata: { branch: 'cp-safe-review' },
    });

    expect(result).toMatchObject({
      success: false,
      error: 'review_egress_broker_not_ready',
      executor: 'codex-review',
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledWith(
      expect.stringContaining('slot-'),
      { recursive: true, force: true },
    );
    expect(rmMock).toHaveBeenCalledWith(
      '/tmp/cecelia-prompts/codex-review-auth/review-stage',
      { recursive: true, force: true },
    );
  });
});
