import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { harness } from './proxy-fixture.js';

const sharedUpgradeObservations = new Map<string, { outcome: string; paths: string[] }>();
afterAll(() => {
  for (const path of ['/api/brain/ws', '/api/orchestrator/realtime/ws']) {
    expect(sharedUpgradeObservations.get(`candidate:${path}`)).toEqual(sharedUpgradeObservations.get(`baseline:${path}`));
    expect(sharedUpgradeObservations.get(`docker-baseline:${path}`)).toEqual(sharedUpgradeObservations.get(`baseline:${path}`));
  }
});

const frame = Buffer.from([0x81, 0x82, 1, 2, 3, 4, 0x69, 0x6b]);
const key = 'YWJjZGVmZ2hpamtsbW5vcA==';
const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
async function upgraded(f: Awaited<ReturnType<typeof harness>>, path: string) {
  const u = new URL(f.origin); if (u.hostname !== '127.0.0.1' || !f.owned.has(u.port)) throw new Error('Unowned WS client');
  return new Promise<Buffer>((resolve, reject) => {
    const socket = f.trackSocket(connect({ host: '127.0.0.1', port: Number(u.port) }));
    const chunks: Buffer[] = [];
    const deadline = f.later(() => { socket.destroy(); reject(new Error('owned WS deadline')); }, 3000);
    socket.on('connect', () => socket.write(Buffer.concat([Buffer.from(`GET ${path} HTTP/1.1\r\nHost: ${u.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`), frame])));
    socket.on('data', chunk => { chunks.push(chunk); const body = Buffer.concat(chunks); if (body.includes(frame)) { clearTimeout(deadline); socket.end(); resolve(body); } });
    socket.on('error', reject);
    socket.once('close', () => { clearTimeout(deadline); if (!Buffer.concat(chunks).includes(frame)) reject(new Error('WS closed before head echo')); });
  });
}
function backendUpgrade(f: Awaited<ReturnType<typeof harness>>, seen: string[]) {
  f.backend.on('upgrade', (req, socket, head) => {
    seen.push(req.url!);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    if (head.length) socket.write(head);
    socket.on('data', data => socket.write(data));
  });
}

describe.each(['baseline', 'docker-baseline', 'candidate'] as const)('Dashboard original WebSocket ownership and head streaming (%s)', mode => {
  for (const [path, expected] of [['/api/orchestrator/realtime/ws?q=lost', '/api/brain/orchestrator/realtime/ws'], ['/api/brain/ws?q=lost', '/ws']]) {
    it(`preserves the actual manual upgrade for ${path}`, async () => {
      const f = await harness(undefined, '', mode); const seen: string[] = []; backendUpgrade(f, seen);
      try {
        expect(f.front.listenerCount('upgrade')).toBe(1);
        const response = await upgraded(f, path);
        expect(response.toString()).toContain('101 Switching Protocols');
        expect(response.includes(frame)).toBe(true); expect(seen).toEqual([expected]);
        expect(f.front.listenerCount('upgrade')).toBe(1);
      } finally { await f.cleanup(); }
    });
  }

  it('keeps n8n first-HTTP lazy subscription, one listener, full URL and unfiltered upgrade behavior', async () => {
    const f = await harness(undefined, '', mode); const seen: string[] = []; backendUpgrade(f, seen);
    try {
      expect(f.front.listenerCount('upgrade')).toBe(1);
      await f.call('/n8n/warm'); expect(f.front.listenerCount('upgrade')).toBe(2);
      await f.call('/n8n/warm-again'); expect(f.front.listenerCount('upgrade')).toBe(2);
      expect((await upgraded(f, '/outside-n8n/upgrade?q=1')).includes(frame)).toBe(true);
      expect(seen).toEqual(['/outside-n8n/upgrade?q=1']);
    } finally { await f.cleanup(); }
  });

  for (const path of ['/api/brain/ws', '/api/orchestrator/realtime/ws']) {
    it(`characterizes the unchanged manual+n8n shared request ordering for ${path}`, async () => {
      const f = await harness(undefined, '', mode); const seen: string[] = []; backendUpgrade(f, seen);
      try {
        await f.call('/n8n/warm'); expect(f.front.listenerCount('upgrade')).toBe(2);
        const outcome = await upgraded(f, path).then(() => 'echo', error => {
          if (error.message === 'WS closed before head echo') return 'closed_before_echo';
          if (error.message === 'owned WS deadline') return 'fixture_deadline';
          throw error;
        });
        await new Promise<void>(resolve => f.later(resolve, 30));
        expect(seen.length).toBeGreaterThan(0); expect(seen.length).toBeLessThanOrEqual(2);
        sharedUpgradeObservations.set(`${mode}:${path}`, { outcome, paths: [...seen] });
      } finally { await f.cleanup(); }
    });
  }

  it('does not dispatch a raw star upgrade after the n8n listener is warm', async () => {
    const f = await harness(undefined, '', mode); const seen: string[] = []; backendUpgrade(f, seen);
    try {
      await f.call('/n8n/warm'); expect(f.front.listenerCount('upgrade')).toBe(2);
      await expect(upgraded(f, '*')).rejects.toThrow('owned WS deadline');
      expect(seen).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it('closes failed dedicated WS upstream sockets without an unhandled proxy error', async () => {
    const f = await harness(undefined, '', mode); await new Promise<void>((resolve, reject) => f.backend.close(e => e ? reject(e) : resolve()));
    try { await expect(upgraded(f, '/api/brain/ws')).rejects.toThrow('WS closed before head echo'); }
    finally { await f.cleanup(); }
  });
});
