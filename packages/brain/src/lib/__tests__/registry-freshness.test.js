import { describe, it, expect } from 'vitest';
import { computeFreshness, PHOTO_STALE_THRESHOLD_HOURS } from '../registry-freshness.js';

describe('computeFreshness', () => {
  const now = new Date('2026-07-18T12:00:00Z');
  const metadata = (minutesAgo, overrides = {}) => ({
    scanned_at: new Date(now.getTime() - minutesAgo * 60_000),
    source_revision: 'abc123',
    scanner_version: 'api-registry-v2',
    ...overrides,
  });

  it('null 输入(从未扫过)→ fail-closed unknown/snapshot_missing', () => {
    const f = computeFreshness(null, now);
    expect(f).toMatchObject({
      status: 'unknown', reason_code: 'snapshot_missing', stale: true,
      latest_scan: null, last_success_at: null, age_hours: null,
      source_revision: null, scanner_version: null,
    });
    expect(f.warning).toContain('run-all-scans');
  });

  it('完整 metadata 14min 前 → fresh，并传播 provenance', () => {
    const f = computeFreshness(metadata(14), now);
    expect(f).toMatchObject({
      status: 'fresh', reason_code: null, stale: false,
      age_hours: 0.2, source_revision: 'abc123', scanner_version: 'api-registry-v2',
      latest_scan: '2026-07-18T11:46:00.000Z', last_success_at: '2026-07-18T11:46:00.000Z',
      warning: null,
    });
  });

  it('完整 metadata 16min 前 → unknown/snapshot_stale', () => {
    const f = computeFreshness(metadata(16), now);
    expect(f).toMatchObject({
      status: 'unknown', reason_code: 'snapshot_stale', stale: true,
      last_success_at: '2026-07-18T11:44:00.000Z', source_revision: 'abc123',
      scanner_version: 'api-registry-v2',
    });
    expect(f.warning).toContain('15min');
  });

  it('旧 timestamp 调用仍接受并保留既有时间字段', () => {
    const f = computeFreshness('2026-07-18T11:30:00Z', now);
    expect(f.latest_scan).toBe('2026-07-18T11:30:00.000Z');
    expect(f.last_success_at).toBe('2026-07-18T11:30:00.000Z');
    expect(f.status).toBe('unknown');
    expect(f.reason_code).toBe('source_revision_missing');
  });

  it('默认 freshness budget 为 15 分钟', () => {
    expect(PHOTO_STALE_THRESHOLD_HOURS).toBe(15 / 60);
  });

  it('无效 scanned_at → unknown/snapshot_time_invalid', () => {
    const f = computeFreshness(metadata(0, { scanned_at: 'not-a-date' }), now);
    expect(f).toMatchObject({
      status: 'unknown', reason_code: 'snapshot_time_invalid', stale: true,
      latest_scan: null, last_success_at: null,
    });
    expect(f.warning).toContain('无效');
  });

  it.each([
    [{ source_revision: '' }, 'source_revision_missing'],
    [{ source_revision: 'legacy-unknown' }, 'source_revision_legacy'],
    [{ scanner_version: '' }, 'scanner_version_missing'],
  ])('provenance 不完整时稳定区分 reason_code=%s', (overrides, reasonCode) => {
    const f = computeFreshness(metadata(1, overrides), now);
    expect(f.status).toBe('unknown');
    expect(f.reason_code).toBe(reasonCode);
    expect(f.last_success_at).toBe('2026-07-18T11:59:00.000Z');
  });
});
