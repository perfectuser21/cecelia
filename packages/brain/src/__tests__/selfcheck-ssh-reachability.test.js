import { describe, it, expect, vi } from 'vitest';
import { checkComputeSshReachability } from '../selfcheck.js';

describe('checkComputeSshReachability', () => {
  it('全部可达 → ok:true, unreachable 空', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'ok\n' });
    const r = await checkComputeSshReachability({ execFn });
    expect(r.ok).toBe(true);
    expect(r.unreachable).toEqual([]);
    expect(execFn).toHaveBeenCalled(); // 对每台 COMPUTE_SERVER 各一次
  });
  it('某台失败 → ok:false 且 unreachable 含该机器 id 与错误(降级可见,不 throw)', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const r = await checkComputeSshReachability({ execFn });
    expect(r.ok).toBe(false);
    expect(r.unreachable.length).toBeGreaterThan(0);
    expect(r.unreachable[0]).toHaveProperty('id');
    expect(r.unreachable[0].error).toContain('Permission denied');
  });
});
