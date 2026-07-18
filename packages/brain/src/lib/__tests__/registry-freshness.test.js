import { describe, it, expect } from 'vitest';
import { computeFreshness, PHOTO_STALE_THRESHOLD_HOURS } from '../registry-freshness.js';

describe('computeFreshness', () => {
  const now = new Date('2026-07-18T12:00:00Z');

  it('null 输入(从未扫过)→ stale:true 且 warning 提示先跑扫描', () => {
    const f = computeFreshness(null, now);
    expect(f.stale).toBe(true);
    expect(f.latest_scan).toBeNull();
    expect(f.age_hours).toBeNull();
    expect(f.warning).toContain('run-all-scans');
  });

  it('23h 前 → fresh(stale:false, warning:null)', () => {
    const f = computeFreshness(new Date('2026-07-17T13:00:00Z'), now);
    expect(f.stale).toBe(false);
    expect(f.warning).toBeNull();
    expect(f.age_hours).toBe(23);
  });

  it('25h 前 → stale:true 且 warning 提到 cron', () => {
    const f = computeFreshness(new Date('2026-07-17T11:00:00Z'), now);
    expect(f.stale).toBe(true);
    expect(f.warning).toContain('cron');
  });

  it('接受字符串时间戳', () => {
    const f = computeFreshness('2026-07-18T11:30:00Z', now);
    expect(f.stale).toBe(false);
    expect(f.latest_scan).toBe('2026-07-18T11:30:00.000Z');
  });

  it('阈值常量为 24', () => {
    expect(PHOTO_STALE_THRESHOLD_HOURS).toBe(24);
  });
});
