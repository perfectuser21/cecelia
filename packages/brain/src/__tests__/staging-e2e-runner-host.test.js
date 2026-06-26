/**
 * runStagingCommand 在生产 brain 容器内跑，必须把合同命令的 :5221 重写成
 * host.docker.internal:5222（不是 localhost:5222，容器内 localhost 不通 staging）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn() }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn() }));
vi.mock('../harness-final-e2e.js', () => ({ normalizeAcceptance: vi.fn() }));
vi.mock('../staging-promote.js', () => ({
  decidePromote: vi.fn(), runInternalPromote: vi.fn(), defaultPromoteExec: vi.fn(),
  getRepoRoot: () => '/repo', PROMOTE_STATUS: {}, spawnHarnessReport: vi.fn(),
  readProductionInfo: vi.fn(), REPORT_KIND: {},
}));

import { runStagingCommand } from '../staging-e2e-runner.js';

describe('runStagingCommand 重写目标 host', () => {
  let origEnv;
  beforeEach(() => { origEnv = process.env.STAGING_HOST; });
  afterEach(() => {
    if (origEnv === undefined) delete process.env.STAGING_HOST;
    else process.env.STAGING_HOST = origEnv;
  });

  it(':5221 重写成 host.docker.internal:5222（默认，不是 localhost:5222）', () => {
    delete process.env.STAGING_HOST;
    const exec = vi.fn(() => '');
    runStagingCommand({ cmd: 'curl -sf http://localhost:5221/api/brain/tick/status' }, { exec });
    const cmd = exec.mock.calls[0][0];
    expect(cmd).toContain('host.docker.internal:5222');
    expect(cmd).not.toContain('localhost:5222');
  });

  it('STAGING_HOST env 可覆盖', () => {
    process.env.STAGING_HOST = '127.0.0.1';
    const exec = vi.fn(() => '');
    runStagingCommand({ cmd: 'curl http://localhost:5221/api/brain/tick/status' }, { exec });
    expect(exec.mock.calls[0][0]).toContain('127.0.0.1:5222');
  });
});
