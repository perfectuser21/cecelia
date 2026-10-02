import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGoldenPathAudit } from '../golden-path-audit.js';
import { readGoldenPathJournal } from '../golden-path-journal.js';
import { fixture, hit } from './gp-audit-fixture.js';

describe('golden-path-journal永久边界', () => {
  it('半行或hash链损坏不能变成健康覆盖', async () => {
    const f = fixture(); await f.audit.recordHttp(hit);
    appendFileSync(f.audit.file, '{half');
    expect(() => readGoldenPathJournal(f.audit.file)).toThrow('gp_journal_corrupt');
    const next = createGoldenPathAudit({ root: f.root, store: f.store,
      source: { git_sha: 'a'.repeat(40), manifest: { audit: 'b'.repeat(64) } }, flag: () => false });
    await next.recover();
    expect(next.status().healthy).toBe(false);
    expect(readGoldenPathJournal(next.file).some(r => r.kind === 'gap')).toBe(true);
  });
  it('journal文件丢失不能从剩余文件推断完整覆盖', async () => {
    const f = fixture(); await f.audit.recordHttp(hit);
    rmSync(f.audit.file);
    await f.audit.recover();
    expect(f.audit.status().healthy).toBe(false);
  });
  it('journal与registration同时丢失仍由独立manifest标为gap', async () => {
    const f = fixture(); await f.audit.start();
    rmSync(f.audit.file); rmSync(f.audit.file.replace('.jsonl', '.registration.json'));
    await f.audit.recover();
    expect(f.audit.status().healthy).toBe(false);
  });
  it('文件介质坏时不调用DB，健康失效且不能冒持久ACK', async () => {
    const f = fixture();
    rmSync(path.dirname(f.audit.file), { recursive: true });
    writeFileSync(path.dirname(f.audit.file), 'obstructed');
    expect((await f.audit.recordHttp(hit)).persisted).toBe(false);
    expect(f.events).toEqual([]);
    expect(f.audit.status().healthy).toBe(false);
  });
});
