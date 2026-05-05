import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execSync: mockExecSync }));

const mockReadCmdline     = vi.hoisted(() => vi.fn());
const mockReadProcessEnv  = vi.hoisted(() => vi.fn());
const mockReadProcessCwd  = vi.hoisted(() => vi.fn());
const mockProcessExists   = vi.hoisted(() => vi.fn());

vi.mock('../../platform-utils.js', () => ({
  readCmdline:    (...a) => mockReadCmdline(...a),
  readProcessEnv: (...a) => mockReadProcessEnv(...a),
  readProcessCwd: (...a) => mockReadProcessCwd(...a),
  processExists:  (...a) => mockProcessExists(...a),
}));

const mockProcessKill = vi.hoisted(() => vi.fn());

let router;

beforeAll(async () => {
  vi.resetModules();
  vi.spyOn(process, 'kill').mockImplementation(mockProcessKill);
  const mod = await import('../../routes/cluster.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/cluster', router);
  return app;
}

describe('cluster routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ── GET /scan-sessions ───────────────────────────────────────────────────

  describe('GET /scan-sessions', () => {
    it('returns parsed processes from ps output', async () => {
      mockExecSync.mockReturnValueOnce(
        'user  1234 0.5 1.2  ... 10:00 claude\n' +
        'user  5678 0.1 0.3  ... 10:01 claude -p /tmp/prompt'
      );

      const res = await request(app).get('/cluster/scan-sessions');
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.body.processes)).toBe(true);
      expect(res.body).toHaveProperty('headed');
      expect(res.body).toHaveProperty('headless');
      expect(res.body).toHaveProperty('scanned_at');
    });

    it('returns empty result when execSync throws', async () => {
      mockExecSync.mockImplementationOnce(() => { throw new Error('no processes'); });

      const res = await request(app).get('/cluster/scan-sessions');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.processes).toEqual([]);
    });

    it('parses headed vs headless counts correctly', async () => {
      // One headed, one headless (-p flag)
      mockExecSync.mockReturnValueOnce(
        'u 100 0.0 0.0 0 0 0 0 0 0:00 10:00 claude\n' +
        'u 200 0.0 0.0 0 0 0 0 0 0:00 10:00 claude -p prompt.txt'
      );
      const res = await request(app).get('/cluster/scan-sessions');
      expect(res.body.headed + res.body.headless).toBe(res.body.total);
    });

    it('skips lines with insufficient fields', async () => {
      mockExecSync.mockReturnValueOnce('user  1234\nuser  5678 0.1 0.3 x x x x x x x claude');
      const res = await request(app).get('/cluster/scan-sessions');
      expect(res.status).toBe(200);
    });
  });

  // ── GET /session-info/:pid ───────────────────────────────────────────────

  describe('GET /session-info/:pid', () => {
    it('returns 400 for non-numeric pid', async () => {
      const res = await request(app).get('/cluster/session-info/abc');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid PID');
    });

    it('returns 400 for zero pid', async () => {
      const res = await request(app).get('/cluster/session-info/0');
      expect(res.status).toBe(400);
    });

    it('returns 404 when process does not exist', async () => {
      mockProcessExists.mockReturnValueOnce(false);
      const res = await request(app).get('/cluster/session-info/9999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Process not found');
    });

    it('returns 404 when cmdline cannot be read', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(null);
      const res = await request(app).get('/cluster/session-info/1234');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Cannot read process info');
    });

    it('returns session info with anthropic provider', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(['/usr/local/bin/claude']);
      mockReadProcessCwd.mockReturnValueOnce('/home/user/cecelia');
      mockReadProcessEnv.mockReturnValueOnce({ CECELIA_PROVIDER: 'anthropic', CECELIA_MODEL: 'sonnet' });

      const res = await request(app).get('/cluster/session-info/1234');
      expect(res.status).toBe(200);
      expect(res.body.pid).toBe(1234);
      expect(res.body.provider).toBe('anthropic');
      expect(res.body.model).toBe('sonnet');
      expect(res.body.projectName).toBe('user/cecelia'); // last 2 path segments
    });

    it('detects minimax provider via ANTHROPIC_BASE_URL', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(['/usr/local/bin/claude']);
      mockReadProcessCwd.mockReturnValueOnce('/home/user/proj');
      mockReadProcessEnv.mockReturnValueOnce({ ANTHROPIC_BASE_URL: 'https://minimax.example.com' });

      const res = await request(app).get('/cluster/session-info/1234');
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe('minimax');
    });

    it('marks foreground vs headless in isForeground', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(['/usr/local/bin/claude', '-p', 'prompt.txt']);
      mockReadProcessCwd.mockReturnValueOnce(null);
      mockReadProcessEnv.mockReturnValueOnce({});

      const res = await request(app).get('/cluster/session-info/1234');
      expect(res.status).toBe(200);
      expect(res.body.isForeground).toBe(false);
    });

    it('handles null cwd gracefully', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(['/usr/local/bin/claude']);
      mockReadProcessCwd.mockReturnValueOnce(null);
      mockReadProcessEnv.mockReturnValueOnce({});

      const res = await request(app).get('/cluster/session-info/1234');
      expect(res.status).toBe(200);
      expect(res.body.projectName).toBeNull();
    });
  });

  // ── GET /session-providers ───────────────────────────────────────────────

  describe('GET /session-providers', () => {
    it('returns empty object if no pids supplied', async () => {
      const res = await request(app).get('/cluster/session-providers');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('returns empty object if pids are non-numeric', async () => {
      const res = await request(app).get('/cluster/session-providers?pids=abc,xyz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('skips non-existent pids', async () => {
      mockProcessExists.mockReturnValue(false);
      const res = await request(app).get('/cluster/session-providers?pids=1234,5678');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('returns provider and model for existing pids', async () => {
      mockProcessExists.mockReturnValueOnce(true).mockReturnValueOnce(true);
      mockReadProcessEnv
        .mockReturnValueOnce({ CECELIA_PROVIDER: 'anthropic', CECELIA_MODEL: 'opus' })
        .mockReturnValueOnce({ ANTHROPIC_BASE_URL: 'https://minimax.io', CECELIA_MODEL: 'mms' });

      const res = await request(app).get('/cluster/session-providers?pids=1,2');
      expect(res.status).toBe(200);
      expect(res.body['1'].provider).toBe('anthropic');
      expect(res.body['2'].provider).toBe('minimax');
    });
  });

  // ── POST /kill-session ───────────────────────────────────────────────────

  describe('POST /kill-session', () => {
    it('returns 400 for missing/invalid pid', async () => {
      const res = await request(app).post('/cluster/kill-session').send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 for zero pid', async () => {
      const res = await request(app).post('/cluster/kill-session').send({ pid: 0 });
      expect(res.status).toBe(400);
    });

    it('returns 404 when process does not exist', async () => {
      mockProcessExists.mockReturnValueOnce(false);
      const res = await request(app).post('/cluster/kill-session').send({ pid: 9999 });
      expect(res.status).toBe(404);
    });

    it('returns 404 when cmdline unreadable', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(null);
      const res = await request(app).post('/cluster/kill-session').send({ pid: 1234 });
      expect(res.status).toBe(404);
    });

    it('returns 403 for headless (non-foreground) claude', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(['/usr/local/bin/claude', '-p', 'prompt.txt']);
      const res = await request(app).post('/cluster/kill-session').send({ pid: 1234 });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Not a foreground');
    });

    it('returns 200 and sends SIGTERM for foreground claude', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(['/usr/local/bin/claude']);
      mockProcessKill.mockImplementationOnce(() => {});

      const res = await request(app).post('/cluster/kill-session').send({ pid: 1234 });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.signal).toBe('SIGTERM');
      expect(mockProcessKill).toHaveBeenCalledWith(1234, 'SIGTERM');
    });

    it('returns 500 when SIGTERM throws', async () => {
      mockProcessExists.mockReturnValueOnce(true);
      mockReadCmdline.mockReturnValueOnce(['/usr/local/bin/claude']);
      mockProcessKill.mockImplementationOnce(() => { throw new Error('permission denied'); });

      const res = await request(app).post('/cluster/kill-session').send({ pid: 1234 });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('SIGTERM failed');
    });
  });
});
