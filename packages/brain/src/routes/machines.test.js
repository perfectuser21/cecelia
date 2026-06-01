import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('child_process', () => ({
  execSync: vi.fn(() => JSON.stringify({
    Self: { TailscaleIPs: ['100.71.151.105/32'] },
    Peer: {
      'abc': {
        TailscaleIPs: ['100.86.57.69/32'],
        Online: true,
        LastSeen: '2026-06-01T00:00:00Z',
      },
    },
  })),
}));

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

import machinesRouter from './machines.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/machines', machinesRouter);
  return app;
}

const MACHINE_ROW = {
  id: 'uuid-1',
  name: 'mac-mini-m4-xian',
  description: '西安 Mac mini M4，Codex 执行机',
  status: 'active',
  metadata: {
    tailscale_ip: '100.86.57.69',
    effective_country: 'US',
    services: [{ name: 'Codex Bridge', port: 3457, needs_cn_ip: false }],
    deprecated: [{ name: 'clawdbot', reason: '待卸载' }],
  },
  updated_at: '2026-06-01T00:00:00Z',
};

describe('machines routes', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/brain/machines', () => {
    it('returns list of machines with tailscale_online and conflicts', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [MACHINE_ROW] });
      const res = await request(makeApp()).get('/api/brain/machines');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toMatchObject({
        name: 'mac-mini-m4-xian',
        tailscale_online: true,
        conflicts: expect.any(Array),
      });
    });

    it('includes deprecated warning in conflicts', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [MACHINE_ROW] });
      const res = await request(makeApp()).get('/api/brain/machines');
      expect(res.status).toBe(200);
      const conflicts = res.body[0].conflicts;
      expect(conflicts.some(c => c.type === 'deprecated')).toBe(true);
    });

    it('returns 500 on db error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('db error'));
      const res = await request(makeApp()).get('/api/brain/machines');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/brain/machines/:name', () => {
    it('returns 404 when machine not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(makeApp()).get('/api/brain/machines/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns machine with conflicts when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [MACHINE_ROW] });
      const res = await request(makeApp()).get('/api/brain/machines/mac-mini-m4-xian');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('mac-mini-m4-xian');
      expect(res.body).toHaveProperty('conflicts');
    });
  });

  describe('PATCH /api/brain/machines/:name', () => {
    it('returns 400 when metadata not provided', async () => {
      const res = await request(makeApp())
        .patch('/api/brain/machines/xian-pc')
        .send({ notes: 'test' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when machine not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(makeApp())
        .patch('/api/brain/machines/nonexistent')
        .send({ metadata: { notes: 'test' } });
      expect(res.status).toBe(404);
    });

    it('merges metadata and returns updated machine', async () => {
      const updated = { ...MACHINE_ROW, metadata: { ...MACHINE_ROW.metadata, notes: 'updated' } };
      mockQuery.mockResolvedValueOnce({ rows: [MACHINE_ROW] });
      mockQuery.mockResolvedValueOnce({ rows: [updated] });
      const res = await request(makeApp())
        .patch('/api/brain/machines/mac-mini-m4-xian')
        .send({ metadata: { notes: 'updated' } });
      expect(res.status).toBe(200);
      expect(res.body.metadata.notes).toBe('updated');
    });
  });

  describe('conflict detection', () => {
    it('flags ip_mismatch when service needs_cn_ip but machine is US', async () => {
      const cnServiceRow = {
        ...MACHINE_ROW,
        metadata: {
          ...MACHINE_ROW.metadata,
          effective_country: 'US',
          services: [{ name: 'Chrome XHS', needs_cn_ip: true }],
          deprecated: [],
        },
      };
      mockQuery.mockResolvedValueOnce({ rows: [cnServiceRow] });
      const res = await request(makeApp()).get('/api/brain/machines');
      expect(res.status).toBe(200);
      const conflicts = res.body[0].conflicts;
      expect(conflicts.some(c => c.type === 'ip_mismatch' && c.severity === 'error')).toBe(true);
    });

    it('no ip_mismatch when service needs_cn_ip and machine is CN', async () => {
      const cnRow = {
        ...MACHINE_ROW,
        metadata: {
          ...MACHINE_ROW.metadata,
          effective_country: 'CN',
          services: [{ name: 'Chrome XHS', needs_cn_ip: true }],
          deprecated: [],
        },
      };
      mockQuery.mockResolvedValueOnce({ rows: [cnRow] });
      const res = await request(makeApp()).get('/api/brain/machines');
      expect(res.status).toBe(200);
      const ipConflicts = res.body[0].conflicts.filter(c => c.type === 'ip_mismatch');
      expect(ipConflicts).toHaveLength(0);
    });
  });
});
