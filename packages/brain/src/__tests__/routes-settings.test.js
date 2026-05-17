import { describe, test, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../consciousness-guard.js', () => ({
  getConsciousnessStatus: vi.fn(),
  setConsciousnessEnabled: vi.fn(),
}));

describe('routes/settings.js', () => {
  let app, getStatus, setEnabled;

  beforeEach(async () => {
    vi.clearAllMocks();
    const guard = await import('../consciousness-guard.js');
    getStatus = guard.getConsciousnessStatus;
    setEnabled = guard.setConsciousnessEnabled;
    const router = (await import('../routes/settings.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/brain/settings', router);
  });

  test('GET /consciousness returns status', async () => {
    getStatus.mockReturnValueOnce({ enabled: true, last_toggled_at: null, env_override: false });
    const res = await request(app).get('/api/brain/settings/consciousness');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, last_toggled_at: null, env_override: false });
  });

  test('PATCH /consciousness with boolean works', async () => {
    setEnabled.mockResolvedValueOnce({
      enabled: false,
      last_toggled_at: '2026-04-20T01:00:00Z',
      env_override: false,
    });
    const res = await request(app)
      .patch('/api/brain/settings/consciousness')
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(setEnabled).toHaveBeenCalledWith(expect.anything(), false);
  });

  test('PATCH with non-boolean returns 400', async () => {
    const res = await request(app)
      .patch('/api/brain/settings/consciousness')
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/);
  });

  test('PATCH without enabled field returns 400', async () => {
    const res = await request(app)
      .patch('/api/brain/settings/consciousness')
      .send({});
    expect(res.status).toBe(400);
  });
});
