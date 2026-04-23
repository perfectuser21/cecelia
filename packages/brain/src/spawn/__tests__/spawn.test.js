/**
 * spawn() smoke test。验证 wrapper 导出 + 参数透传 + 返回值透传。
 * P2 PR11 清 SPAWN_V2_ENABLED flag 后，原两条等价分支测试合并成一条透传测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteInDocker = vi.fn();
vi.mock('../../docker-executor.js', () => ({
  executeInDocker: (...args) => mockExecuteInDocker(...args),
}));

describe('spawn() wrapper', () => {
  beforeEach(() => {
    mockExecuteInDocker.mockReset();
    mockExecuteInDocker.mockResolvedValue({ exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 100 });
  });

  it('exports spawn as async function', async () => {
    const { spawn } = await import('../spawn.js');
    expect(typeof spawn).toBe('function');
  });

  it('passes opts through to executeInDocker unchanged', async () => {
    const { spawn } = await import('../spawn.js');
    const opts = { task: { id: 't1' }, skill: '/test', prompt: 'hi' };
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
