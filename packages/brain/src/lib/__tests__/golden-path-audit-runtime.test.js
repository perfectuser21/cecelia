import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { goldenPathSource, startGoldenPathAudit, goldenPathAuditListening, stopGoldenPathAudit } from '../golden-path-audit-runtime.js';
import { readGoldenPathJournal, listGoldenPathJournals } from '../golden-path-journal.js';
import { readGoldenPathT0Archive } from '../golden-path-archive.js';
const roots = [];
afterEach(async () => { await stopGoldenPathAudit(); vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('正式候选先监听覆盖，外部真实T0后才独立归档，跨部署保同窗与精确source', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-runtime-private-')); roots.push(root);
  const env = { NODE_ENV: 'production', REPO_ROOT: root, GIT_SHA: 'a'.repeat(40) };
  const source = goldenPathSource(env), windowId = randomUUID();
  const window = { window_id: windowId, sources: [source] }; let t0 = null, nextId = 1;
  const events = [];
  const client = { release() {}, async query(input) {
    if (input.text.includes('INSERT INTO')) {
      const payload = JSON.parse(input.values[1]);
      const row = { id: nextId++, payload: { ...payload, gp_db_created_at: new Date().toISOString() },
        created_at: new Date(), gp_db_created_at: new Date().toISOString(), db_time: new Date() };
      events.push(row); return { rows: [row] };
    }
    return { rows: [] };
  } };
  const pool = { connect: async () => client, async query(input) {
    if (input.text.includes('FROM tasks')) return { rows: [{ window }] };
    if (input.text.includes('FROM cecelia_events')) return { rows: t0 ? [t0] : [] };
    throw new Error('unexpected query');
  } };
  expect(await startGoldenPathAudit({ pool, env })).toMatchObject({ window_id: windowId });
  await goldenPathAuditListening();
  const dir = path.join(root, 'logs/gp-observation', windowId);
  expect(fs.existsSync(path.join(dir, 't0-receipt.json'))).toBe(false);
  window.t0_event_id = 500;
  t0 = { id: 500, created_at: new Date(), payload: { window_id: windowId, source, gp_db_created_at: new Date().toISOString() } };
  await vi.advanceTimersByTimeAsync(30_000);
  expect(readGoldenPathT0Archive(dir).id).toBe(500);
  expect(events.some(row => row.payload.lifecycle === 'heartbeat')).toBe(true);
  expect(await stopGoldenPathAudit()).toEqual({ completed: true });
  expect(await startGoldenPathAudit({ pool, env })).toMatchObject({ window_id: windowId });
  await goldenPathAuditListening(); await stopGoldenPathAudit();
  const files = listGoldenPathJournals(dir); expect(files).toHaveLength(2);
  for (const file of files) {
    const rows = readGoldenPathJournal(file);
    expect(rows.some(row => row.kind === 'gap')).toBe(false);
    expect(rows.filter(row => row.kind === 'intent').map(row => row.payload.lifecycle))
      .toEqual(expect.arrayContaining(['instance_start', 'listening', 'instance_end']));
  }
  expect(events.some(row => row.event_type === 'golden_path_observation_t0')).toBe(false);
});
