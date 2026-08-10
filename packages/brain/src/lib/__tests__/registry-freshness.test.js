import { describe, it, expect } from 'vitest';
import { computeFreshness, PHOTO_STALE_THRESHOLD_HOURS } from '../registry-freshness.js';

describe('computeFreshness', () => {
  const now = new Date('2026-07-18T12:00:00Z');
  const sha40 = 'a'.repeat(40);
  const sha64 = 'b'.repeat(64);
  const metadata = (minutesAgo, overrides = {}) => ({
    scanned_at: new Date(now.getTime() - minutesAgo * 60_000),
    source_revision: sha40,
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
      age_hours: 0.2, source_revision: sha40, scanner_version: 'api-registry-v2',
      latest_scan: '2026-07-18T11:46:00.000Z', last_success_at: '2026-07-18T11:46:00.000Z',
      warning: null,
    });
  });

  it('完整 metadata 16min 前 → unknown/snapshot_stale', () => {
    const f = computeFreshness(metadata(16), now);
    expect(f).toMatchObject({
      status: 'unknown', reason_code: 'snapshot_stale', stale: true,
      last_success_at: '2026-07-18T11:44:00.000Z', source_revision: sha40,
      scanner_version: 'api-registry-v2',
    });
    expect(f.warning).toContain('15min');
  });

  it('恰好 15min 仍 fresh，超过 1ms 即 unknown/snapshot_stale', () => {
    const exact = computeFreshness(metadata(15), now);
    const over = computeFreshness(metadata(15, {
      scanned_at: new Date(now.getTime() - 15 * 60_000 - 1),
    }), now);

    expect(exact).toMatchObject({ status: 'fresh', reason_code: null, stale: false });
    expect(over).toMatchObject({ status: 'unknown', reason_code: 'snapshot_stale', stale: true });
  });

  it('无效 now → unknown/clock_invalid 且 fail-closed stale=true', () => {
    const f = computeFreshness(metadata(1), new Date('not-a-date'));
    expect(f).toMatchObject({
      status: 'unknown', reason_code: 'clock_invalid', stale: true,
      source_revision: sha40, scanner_version: 'api-registry-v2',
    });
  });

  it('快照超过未来 60s → unknown/snapshot_from_future', () => {
    const f = computeFreshness(metadata(0, {
      scanned_at: new Date(now.getTime() + 60_001),
    }), now);
    expect(f).toMatchObject({
      status: 'unknown', reason_code: 'snapshot_from_future', stale: true,
      age_hours: 0,
    });
  });

  it('未来 60s 容差内按 age=0 处理并保持 fresh', () => {
    const f = computeFreshness(metadata(0, {
      scanned_at: new Date(now.getTime() + 60_000),
    }), now);
    expect(f).toMatchObject({
      status: 'fresh', reason_code: null, stale: false, age_hours: 0,
    });
  });

  it('旧 timestamp 调用仍接受并保留既有时间字段', () => {
    const f = computeFreshness('2026-07-18T11:30:00Z', now);
    expect(f.latest_scan).toBe('2026-07-18T11:30:00.000Z');
    expect(f.last_success_at).toBe('2026-07-18T11:30:00.000Z');
    expect(f.status).toBe('unknown');
    expect(f.reason_code).toBe('source_revision_missing');
    expect(f.stale).toBe(true);
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

  it.each([
    'abc123',
    'g'.repeat(40),
    'a'.repeat(39),
    'a'.repeat(65),
  ])('非完整 Git object id %s → unknown/source_revision_invalid', (sourceRevision) => {
    const f = computeFreshness(metadata(1, { source_revision: sourceRevision }), now);
    expect(f.status).toBe('unknown');
    expect(f.reason_code).toBe('source_revision_invalid');
  });

  it("scanner_version='legacy' → unknown/scanner_version_legacy", () => {
    const f = computeFreshness(metadata(1, { scanner_version: 'legacy' }), now);
    expect(f.status).toBe('unknown');
    expect(f.reason_code).toBe('scanner_version_legacy');
  });

  it.each(['api-registry', 'API-v2', 'foo-v0', 'foo_v1', 'foo-v01'])(
    'scanner_version=%s 不符合通用版本格式 → unknown/scanner_version_invalid',
    (scannerVersion) => {
      const f = computeFreshness(metadata(1, { scanner_version: scannerVersion }), now);
      expect(f.status).toBe('unknown');
      expect(f.reason_code).toBe('scanner_version_invalid');
    },
  );

  it.each([
    [sha40, 'api-registry-v2'],
    [sha40, 'db-schema-v2'],
    [sha40, 'test-registry-v2'],
    [sha40, 'graph-v3'],
    [sha64, 'foo-v1'],
  ])('合法 revision=%s 与 scanner=%s → fresh', (sourceRevision, scannerVersion) => {
    const f = computeFreshness(metadata(1, {
      source_revision: sourceRevision, scanner_version: scannerVersion,
    }), now);
    expect(f.status).toBe('fresh');
    expect(f.reason_code).toBeNull();
  });
});
