/**
 * Tests for spawnReviewPreview runtime routing in staging-e2e-runner.js.
 * Verifies: container→container-local bash, non-container→host-local bash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- module mocks (must come before import) ---
vi.mock('child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn() }));
vi.mock('../notifier.js', () => ({
  sendFeishu: vi.fn(),
  sendBark: vi.fn().mockResolvedValue(true),
}));
vi.mock('../staging-acceptance.js', () => ({ normalizeAcceptance: vi.fn(value => value) }));
vi.mock('../staging-promote.js', async (importActual) => ({
  ...await importActual(),
  resolveLine: () => 'internal', decidePromote: () => ({ action: 'none', line: 'internal' }), runInternalPromote: vi.fn(), defaultPromoteExec: vi.fn(),
  getRepoRoot: () => '/repo', PROMOTE_STATUS: {},
}));
vi.mock('../preview-manager.js', () => ({ allocatePort: vi.fn() }));

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { spawnReviewPreview, runStagingE2E } from '../staging-e2e-runner.js';

import { allocatePort } from '../preview-manager.js';
import { sendBark } from '../notifier.js';

const HOST_REPO = '/Users/administrator/perfect21/cecelia';

describe('spawnReviewPreview — SSH escape logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CECELIA_HOST_REPO;
    delete process.env.CECELIA_HOST_EXEC_SSH;
    delete process.env.REPO_ROOT;
  });

  it('容器内 (inContainer=true) → spawnSync 以 bash 调用容器内脚本', () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    spawnReviewPreview(5301, 42, { inContainer: true });

    expect(spawnSync).toHaveBeenCalledOnce();
    const [cmd, args] = spawnSync.mock.calls[0];
    expect(cmd).toBe('bash');
    expect(args[0]).toBe('/app/scripts/review-preview.sh');
    expect(args[1]).toBe('5301');
    expect(args[2]).toBe('42');
    expect(args[3]).toBe(`${HOST_REPO}/apps/dashboard/.dist-staging`);
  });

  it('非容器 (inContainer=false) → spawnSync 以 bash 调用本地脚本', () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    spawnReviewPreview(5302, 99, { inContainer: false });

    expect(spawnSync).toHaveBeenCalledOnce();
    const [cmd, args] = spawnSync.mock.calls[0];
    expect(cmd).toBe('bash');
    expect(args[0]).toContain('review-preview.sh');
    expect(args[1]).toBe('5302');
    expect(args[2]).toBe('99');
  });

  it('auto-detect: existsSync("/.dockerenv")=true → 容器内 bash 路径', () => {
    existsSync.mockImplementation(p => p === '/.dockerenv');
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    spawnReviewPreview(5303, 77);

    const [cmd, args] = spawnSync.mock.calls[0];
    expect(cmd).toBe('bash');
    expect(args[0]).toBe('/app/scripts/review-preview.sh');
  });

  it('auto-detect: existsSync("/.dockerenv")=false → bash 路径', () => {
    existsSync.mockImplementation(p => p !== '/.dockerenv');
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

    spawnReviewPreview(5304, 55);

    const [cmd] = spawnSync.mock.calls[0];
    expect(cmd).toBe('bash');
  });
});


describe('真实 runStagingE2E 的 review 交付分支', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allocatePort.mockReset().mockResolvedValue(5377);
    spawnSync.mockReset().mockReturnValue({ status: 0, stdout: '', stderr: '' });
    existsSync.mockImplementation(() => false);
  });

  async function run({ pass = true, pr = 77 } = {}) {
    const release = vi.fn();
    const result = await runStagingE2E({ id: 'preview-task', payload: {
      initiative_id: 'initiative-test', pr_number: pr, branch_name: 'cp-preview', base_repo: 'cecelia',
    } }, {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      loadAcceptance: async () => ({ scenarios: [{ name: 'observable-case', commands: [{ cmd: 'fixture-only' }] }] }),
      deploy: async () => ({ status: 'success', output: 'isolated deploy result' }),
      acquireStagingLock: async () => ({ release }),
      getSha: () => 'a'.repeat(40),
      exec: () => { if (!pass) throw Object.assign(new Error('fixture scenario failed'), { status: 1 }); return 'ok'; },
      runGoldenSmokeRegression: () => ({ verdict: 'PASS', total: 1, passed: 1, failed: 0, skipped: 0 }),
    });
    // PASS 分支启动 fire-and-forget，等其当前微任务完成；不运行真实部署或通知。
    await new Promise(resolve => setImmediate(resolve));
    expect(release).toHaveBeenCalledOnce();
    return result;
  }

  it('PASS 把 PR 分配的端口传入预览与通知', async () => {
    expect((await run()).verdict).toBe('PASS');
    expect(allocatePort).toHaveBeenCalledWith(77, 'cp-preview', 'cecelia', expect.any(Object));
    expect(spawnSync).toHaveBeenCalledOnce();
    expect(spawnSync.mock.calls[0][0]).toBe('bash');
    expect(spawnSync.mock.calls[0][1].slice(1, 3)).toEqual(['5377', '77']);
    expect(sendBark).toHaveBeenCalledWith('✅ Review Ready — PR #77', expect.stringContaining(':5377'));
  });

  it.each([{ pass: false, pr: 77 }, { pass: true, pr: 0 }])('非 PASS 或缺 PR 时零预览：%j', async options => {
    expect((await run(options)).verdict).toBe(options.pass ? 'PASS' : 'FAIL');
    expect(allocatePort).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('端口分配失败不覆盖已完成的 PASS', async () => {
    allocatePort.mockRejectedValueOnce(new Error('fixture port allocation failed'));
    expect((await run()).verdict).toBe('PASS');
    expect(spawnSync).not.toHaveBeenCalled();
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('预览启动失败不发送就绪通知，也不覆盖 PASS', async () => {
    spawnSync.mockReturnValueOnce({ status: 1, stderr: 'fixture preview failed' });
    expect((await run()).verdict).toBe('PASS');
    expect(spawnSync).toHaveBeenCalledOnce();
    expect(sendBark).not.toHaveBeenCalled();
  });
});
