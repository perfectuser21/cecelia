/**
 * deployStaging 必须用绝对路径调 staging-deploy.sh（容器 cwd=/app，相对路径找不到）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// staging-e2e-runner 的副作用 import 全 mock
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn() }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn() }));
vi.mock('../harness-final-e2e.js', () => ({ normalizeAcceptance: vi.fn() }));
vi.mock('../staging-promote.js', () => ({
  decidePromote: vi.fn(), runInternalPromote: vi.fn(), defaultPromoteExec: vi.fn(),
  getRepoRoot: () => '/fallback/repo', PROMOTE_STATUS: {}, spawnHarnessReport: vi.fn(),
  readProductionInfo: vi.fn(), REPORT_KIND: {},
}));

import { deployStaging } from '../staging-e2e-runner.js';

describe('deployStaging 绝对路径', () => {
  let origEnv;
  beforeEach(() => { origEnv = process.env.REPO_ROOT; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = origEnv;
  });

  it('用 REPO_ROOT env 拼绝对路径 + cwd', () => {
    process.env.REPO_ROOT = '/fake/repo';
    const exec = vi.fn(() => '');
    deployStaging({ exec });
    const [cmd, optsArg] = exec.mock.calls[0];
    expect(cmd).toBe('bash /fake/repo/scripts/staging-deploy.sh');
    expect(optsArg.cwd).toBe('/fake/repo');
  });

  it('REPO_ROOT 缺失 → fallback getRepoRoot()', () => {
    delete process.env.REPO_ROOT;
    const exec = vi.fn(() => '');
    deployStaging({ exec });
    expect(exec.mock.calls[0][0]).toBe('bash /fallback/repo/scripts/staging-deploy.sh');
    expect(exec.mock.calls[0][1].cwd).toBe('/fallback/repo');
  });

  it('opts.cwd 优先级最高', () => {
    process.env.REPO_ROOT = '/fake/repo';
    const exec = vi.fn(() => '');
    deployStaging({ exec, cwd: '/override' });
    expect(exec.mock.calls[0][0]).toBe('bash /override/scripts/staging-deploy.sh');
    expect(exec.mock.calls[0][1].cwd).toBe('/override');
  });

  it('STAGING_SKIP_REASON → skipped（不回归降级行为）', () => {
    process.env.REPO_ROOT = '/fake/repo';
    const exec = vi.fn(() => 'STAGING_SKIP_REASON=no_docker');
    expect(deployStaging({ exec }).status).toBe('skipped');
  });
});
