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
vi.mock('../harness-final-e2e.js', () => ({ normalizeAcceptance: vi.fn() }));
vi.mock('../staging-promote.js', () => ({
  decidePromote: vi.fn(), runInternalPromote: vi.fn(), defaultPromoteExec: vi.fn(),
  getRepoRoot: () => '/repo', PROMOTE_STATUS: {}, spawnHarnessReport: vi.fn(),
  readProductionInfo: vi.fn(), REPORT_KIND: {},
}));
vi.mock('../preview-manager.js', () => ({ allocatePort: vi.fn() }));

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { spawnReviewPreview } from '../staging-e2e-runner.js';

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
