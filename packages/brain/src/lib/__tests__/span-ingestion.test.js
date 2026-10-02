import { existsSync } from 'node:fs';
import { it, expect } from 'vitest';
it('服务端摘要按规范JSON归一化，证据变化改变摘要，未带发生键保留旧语义', async () => {
  expect(existsSync(new URL('../span-ingestion.js', import.meta.url)), 'Span写入服务必须存在').toBe(true);
  const { normalizeSpan } = await import('../span-ingestion.js');
  const base = { run_id: 'r', activity_id: 'c1000000-0000-4000-8000-000000000001', started_at: '2026-10-02T10:00:00Z', executor_kind: 'code', occurrence_key: 'first' };
  const a = normalizeSpan({ ...base, evidence: { z: 1, a: { b: 2, a: 3 } } }, 0);
  const b = normalizeSpan({ ...base, evidence: { a: { a: 3, b: 2 }, z: 1 }, payload_sha256: 'fake' }, 0);
  expect(a.payload_sha256).toMatch(/^[0-9a-f]{64}$/); expect(b.payload_sha256).toBe(a.payload_sha256);
  expect(normalizeSpan({ ...base, evidence: { z: 2 } }, 0).payload_sha256).not.toBe(a.payload_sha256);
  expect(normalizeSpan({ ...base, occurrence_key: undefined }, 0).payload_sha256).toBeNull();
});
