import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGoldenPathAudit } from '../golden-path-audit.js';
import { readGoldenPathT0 } from '../golden-path-window.js';
import { archiveGoldenPathT0, readGoldenPathT0Archive } from '../golden-path-archive.js';
import { goldenPathSource } from '../golden-path-audit-runtime.js';
import { fixture } from './gp-audit-fixture.js';

describe('golden-path-archive永久边界', () => {
  it('T0独立归档不随实例journal丢失，不用任务自报日期补证', async () => {
    const f = fixture(), windowId = randomUUID(), source = goldenPathSource({ GIT_SHA: 'a'.repeat(40) });
    const receipt = { id: 123, created_at: '2026-10-02T00:00:00Z', payload: { window_id: windowId, source, gp_db_created_at: '2026-10-02T00:00:00Z' } };
    const audit = createGoldenPathAudit({ root: f.root, store: f.store, source, windowId, flag: () => false });
    await audit.archiveT0(receipt);
    rmSync(audit.file); rmSync(audit.file.replace('.jsonl', '.registration.json'));
    const result = await readGoldenPathT0({ pool: { query: async () => ({ rows: [] }) }, root: f.root,
      window: { window_id: windowId, t0_event_id: 123, source } });
    expect(result).toEqual(receipt);
  });
  it('窗口独立T0不能被不同DB回执覆盖', () => {
    const f = fixture();
    const receipt = { id: 123, created_at: '2026-10-02T00:00:00Z' };
    archiveGoldenPathT0(f.root, receipt); archiveGoldenPathT0(f.root, receipt);
    expect(() => archiveGoldenPathT0(f.root, { ...receipt, created_at: '2026-10-03T00:00:00Z' }))
      .toThrow('gp_t0_archive_conflict');
    expect(readGoldenPathT0Archive(f.root)).toEqual(receipt);
  });

});
