import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import express from 'express';
import { fixture } from './gp-audit-fixture.js';
import { observeGoldenPathLegacy } from '../golden-path-observation.js';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { goldenPathSource, startGoldenPathAudit, goldenPathAuditListening, stopGoldenPathAudit, setGoldenPathAudit, drainGoldenPathListener } from '../golden-path-audit-runtime.js';
import { readGoldenPathJournal, listGoldenPathJournals } from '../golden-path-journal.js';
import { readGoldenPathT0Archive, archiveGoldenPathT0 } from '../golden-path-archive.js';
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
  t0 = { event_type: 'golden_path_observation_t0', event_source: 'golden-path-retirement', storage_type: 'timestamp without time zone', storage_text: '2026-10-02T00:00:00.000000', issuance: { format: 'gp-t0-issuer-v1', storage_type: 'timestamp without time zone', storage_text: '2026-10-02T00:00:00.000000', clock_utc_text: '2026-10-02T00:00:00.000000' }, id: 500, created_at: new Date(), payload: { window_id: windowId, source, gp_db_created_at: new Date().toISOString() } };
  // 外部受控发行的DB回执夹具；runtime本身不得把普通DB行自动升格。
  const receipt = { ...t0 }; delete receipt.storage_type; delete receipt.storage_text; delete receipt.event_type; delete receipt.event_source;
  archiveGoldenPathT0(dir, receipt);
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

it('真实慢body未排空关机必须gap且不得clean end；后到请求不冒零调用', async () => {
  const f = fixture(); setGoldenPathAudit(f.audit); await f.audit.start();
  const app = express(); let entered; const entry = new Promise(r => { entered = r; });
  app.use((_req, _res, next) => { entered(); next(); }); app.use(express.json()); app.use(observeGoldenPathLegacy);
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  await goldenPathAuditListening();
  const socket = net.connect(server.address().port, '127.0.0.1'); let reply = '';
  socket.on('data', data => { reply += data.toString(); }); await new Promise(r => socket.once('connect', r));
  socket.write('POST /golden_path HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{');
  await entry;
  const drained = await drainGoldenPathListener(server, 10);
  try {
    expect(drained).toBe(false);
    expect(await stopGoldenPathAudit({ timeoutMs: 20, listenerDrained: drained })).toMatchObject({ completed: false });
    expect(f.audit.status()).toMatchObject({ healthy: false, lastGap: 'gp_shutdown_incomplete' });
    const rows = readGoldenPathJournal(f.audit.file);
    expect(rows.some(row => row.kind === 'gap')).toBe(true);
    expect(rows.some(row => row.kind === 'intent' && row.payload.lifecycle === 'instance_end')).toBe(false);
    socket.write('}'); await new Promise(r => socket.once('close', r)); expect(reply).toContain('410');
  } finally { socket.destroy(); server.closeAllConnections(); }
});

it('真实正常排空回执才允许clean instance_end', async () => {
  const f = fixture(); setGoldenPathAudit(f.audit); await f.audit.start();
  const app = express(); app.get('/ok', (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  await goldenPathAuditListening();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/ok`); await response.json();
  const drained = await drainGoldenPathListener(server, 200);
  expect(drained).toBe(true); expect(await stopGoldenPathAudit({ listenerDrained: drained })).toEqual({ completed: true });
  expect(f.audit.status().healthy).toBe(true);
  expect(readGoldenPathJournal(f.audit.file).some(row => row.kind === 'intent' && row.payload.lifecycle === 'instance_end')).toBe(true);
});
it('观测启动未获得持久ACK拒绝启动，不以warning后继续接listener', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-startup-failed-private-')); roots.push(root);
  const pool = { query: async () => ({ rows: [{ window: null }] }), connect: async () => { throw new Error('database unavailable'); } };
  await expect(startGoldenPathAudit({ pool, env: { NODE_ENV: 'production', REPO_ROOT: root, GIT_SHA: 'a'.repeat(40) } }))
    .rejects.toThrow('gp_startup_incomplete');
});
