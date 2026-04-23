/**
 * spawn() skeleton smoke test。
 * 验证 wrapper 存在、参数透传、SPAWN_V2_ENABLED 两条分支等价。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExecuteInDocker = vi.fn();
vi.mock('../../docker-executor.js', () => ({
  executeInDocker: (...args) => mockExecuteInDocker(...args),
}));

describe('spawn() skeleton (P2 PR1)', () => {
  beforeEach(() => {
    mockExecuteInDocker.mockReset();
    mockExecuteInDocker.mockResolvedValue({ exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 100 });
  });

  afterEach(() => {
    delete process.env.SPAWN_V2_ENABLED;
  });

  it('exports spawn as async function', async () => {
    const { spawn } = await import('../spawn.js');
    expect(typeof spawn).toBe('function');
  });

  it('passes opts through to executeInDocker (v2 enabled, default)', async () => {
    const { spawn } = await import('../spawn.js');
    const opts = { task: { id: 't1' }, skill: '/test', prompt: 'hi' };
    await spawn(opts);
    expect(mockExecuteInDocker).toHaveBeenCalledWith(opts);
  });

  it('passes opts through to executeInDocker (v2 disabled)', async () => {
    process.env.SPAWN_V2_ENABLED = 'false';
    vi.resetModules();
    const { spawn } = await import('../spawn.js');
    const opts = { task: { id: 't2' }, skill: '/test', prompt: 'bye' };
    await spawn(opts);
    expect(mockExecuteInDocker).toHaveBeenCalledWith(opts);
  });

  it('returns executeInDocker result unchanged', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker.mockResolvedValue({ exit_code: 0, stdout: 'hello', stderr: '', duration_ms: 42 });
    const result = await spawn({ task: {}, skill: '/x', prompt: '' });
    expect(result).toEqual({ exit_code: 0, stdout: 'hello', stderr: '', duration_ms: 42 });
  });
});
