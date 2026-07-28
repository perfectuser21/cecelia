import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const execFileSyncMock = vi.fn();
const accessMock = vi.fn();
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();
const unlinkSyncMock = vi.fn();
const rmMock = vi.fn();
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
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  },
}));
vi.mock('../decisions-context.js', () => ({
  getDecisionsSummary: vi.fn(async () => ''),
}));
vi.mock('../lib/codex-review-boundary.js', () => ({
  extractCodexReviewBranch: vi.fn(() => 'cp-safe-review'),
  resolveCodexReviewWorktree: (...args) => resolveWorktreeMock(...args),
  readCodexReviewFile: (...args) => readReviewFileMock(...args),
  resolveCodexReviewAuthFile: vi.fn(() => '/review-auth/auth.json'),
  resolveCodexReviewImage: vi.fn(() => `sha256:${'a'.repeat(64)}`),
  buildCodexReviewDockerArguments: vi.fn(() => [
    'run',
    '--rm',
    '--interactive',
    '--read-only',
    '--cap-drop=ALL',
    '--user',
    '1001:1001',
    '--mount',
    'type=bind,src=/allowed/cp-safe-review,dst=/workspace,readonly',
    '--mount',
    'type=bind,src=/review-auth/auth.json,dst=/run/codex-auth,readonly',
    `sha256:${'a'.repeat(64)}`,
    'codex-review',
  ]),
  buildCodexReviewDockerEnvironment: vi.fn(() => Object.freeze({
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: '/nonexistent',
    TMPDIR: '/tmp',
  })),
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
  let child;
  let fetchMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    child = childFixture();
    spawnMock.mockReturnValue(child);
    resolveWorktreeMock.mockReturnValue('/allowed/cp-safe-review');
    rmMock.mockResolvedValue();
    fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    ({ triggerCodexReview } = await import('../executor.js'));
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
        '--interactive',
        '--read-only',
        '--cap-drop=ALL',
        '--user',
        '1001:1001',
        '--mount',
        'type=bind,src=/allowed/cp-safe-review,dst=/workspace,readonly',
        '--mount',
        'type=bind,src=/review-auth/auth.json,dst=/run/codex-auth,readonly',
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
    expect(readReviewFileMock).toHaveBeenCalledWith({
      worktreePath: '/allowed/cp-safe-review',
      fileName: '.task-cp-safe-review.md',
    });
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
        'origin/main..HEAD',
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
      expect(fetchMock).toHaveBeenCalled();
    });

    const callback = fetchMock.mock.calls.find(([url]) => (
      String(url).endsWith('/api/brain/execution-callback')
    ));
    expect(JSON.parse(callback[1].body)).toMatchObject({
      status: 'AI Failed',
      result: {
        verdict: 'FAIL',
        summary: 'review failed',
      },
    });
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
});
