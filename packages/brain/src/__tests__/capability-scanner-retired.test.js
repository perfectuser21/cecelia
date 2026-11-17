import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const io = vi.hoisted(() => ({ query: vi.fn(), probeStatus: vi.fn(), probeResults: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: io.query } }));
vi.mock('../stats.js', () => ({ getMonthlyPRCount: vi.fn(), getMonthlyPRsByKR: vi.fn(), getPRSuccessRate: vi.fn(), getPRTrend: vi.fn() }));
vi.mock('../cortex.js', () => ({ searchRelevantAnalyses: vi.fn() }));
vi.mock('../cortex-quality.js', () => ({ evaluateQualityInitial: vi.fn(), checkShouldCreateRCA: vi.fn(), getQualityStats: vi.fn() }));
vi.mock('../routes/shared.js', () => ({ getActiveExecutionPaths: vi.fn(), INVENTORY_CONFIG: {} }));
vi.mock('../capability-probe.js', () => ({ getProbeStatus: io.probeStatus, getProbeResults: io.probeResults }));
import analytics from '../routes/analytics.js';

const app = express();
app.use(express.json());
app.use('/api/brain', analytics);
beforeEach(() => {
  vi.clearAllMocks();
  io.query.mockResolvedValue({ rows: [] });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('禁止外部网络'); }));
});
afterAll(() => vi.unstubAllGlobals());

describe('旧能力扫描退役边界', () => {
  for (const [method, path] of [['get', '/capabilities/health'], ['post', '/capabilities/scan']]) {
    it(`${method} ${path} 返回410，且不访问数据库或触发新扫描`, async () => {
      const response = await request(app)[method](`/api/brain${path}`).send({});
      expect(response.status).toBe(410);
      expect(response.body).toMatchObject({ error: 'capability_scanner_retired' });
      expect(io.query).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });
  }

  it('仍允许按能力ID读取旧目录，不受health静态路由影响', async () => {
    io.query.mockResolvedValue({ rows: [{ id: 'existing', name: '能力目录' }] });
    const response = await request(app).get('/api/brain/capabilities/existing');
    expect(response.status).toBe(200);
    expect(io.query.mock.calls[0][0]).toContain('capabilities_legacy');
  });

  it('保留真实探针状态与历史诊断读面', async () => {
    io.probeStatus.mockReturnValue({ running: false });
    io.probeResults.mockResolvedValue([{ probe_id: 'tasks', status: 'ok' }]);
    const response = await request(app).get('/api/brain/probes/status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: { running: false }, recent_results: [{ probe_id: 'tasks', status: 'ok' }] });
    expect(io.query).not.toHaveBeenCalled();
  });

  it('保留按Task查询历史Cortex诊断', async () => {
    io.query.mockResolvedValue({ rows: [{ id: 'analysis', task_id: 'task-existing' }] });
    const response = await request(app).get('/api/brain/cortex/analyses?task_id=task-existing');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'analysis', task_id: 'task-existing' }]);
    expect(io.query.mock.calls[0][1]).toEqual(['task-existing']);
  });
});
