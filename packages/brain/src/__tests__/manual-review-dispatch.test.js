import { describe, it, expect, vi } from 'vitest';
import { dispatchManualRegistryReview } from '../lib/manual-review-dispatch.js';

describe('手动审查设备锁结果未知', () => {
  it('设备闸抛错时不释放任务认领，因为锁可能已经提交', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ claim_stamp: '2026-01-01T00:00:00Z', claim_version: '8' }] });
    const result = await dispatchManualRegistryReview(
      { id: 't', task_type: 'architecture_scan', dispatch_row_version: '7', payload: { device_serial: 'd' } },
      { query },
      { deviceGate: vi.fn().mockRejectedValue(new Error('reply lost')) },
    );
    expect(result.status).toBe(503);
    expect(result.body.error).toBe('dispatch_state_unknown');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
