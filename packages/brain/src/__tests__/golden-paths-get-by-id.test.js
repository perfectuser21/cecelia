/**
 * golden-paths-get-by-id.test.js
 * GET /api/brain/golden-paths/:id — 单条 GP 详情含 steps_count/steps[]
 * 防御断言：journey steps_count=0 时日志 warn（ccf85841 修复回归测试）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));
vi.mock('../fleet-resource-cache.js', () => ({ getTotalEffectiveSlots: vi.fn(() => 4) }));
vi.mock('../golden-path-contracts.js', () => ({
  GoldenPathContractError: class extends Error {},
  createGoldenPathContractVersion: vi.fn(),
  launchLatestSignedGoldenPath: vi.fn(),
}));

const { default: goldenPathsRouter } = await import('../routes/golden-paths.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', goldenPathsRouter);
  return app;
}

const GP_ID = '7790f728-f490-4243-b166-03f3250a0938';
const JOURNEY_ID = '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6';
const STEP_ID = '817f59f5-02ff-4a70-bd81-f7ae65f77e02';

beforeEach(() => { queryMock.mockReset(); });

describe('GET /api/brain/golden-paths/:id（F2 GP steps 诊断端点）', () => {
  it('GP 存在且 journey 有 steps → 返回 steps_count=4 和 steps 数组', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: GP_ID, title: 'F2加厚', journey_id: JOURNEY_ID, status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [
        { id: STEP_ID, step_number: 2, name: '部署被证明没坏', promise: null, status: null },
        { id: '0ab79a73-1ec3-4ddc-bb88-1433568ae2e2', step_number: 1, name: '生产自动换血', promise: null, status: null },
        { id: '89810e9b-6d05-4d5d-b63f-f528f14a05bb', step_number: 3, name: '预演环境随叫随到', promise: null, status: null },
        { id: 'fb48b077-5550-4069-96d7-013d87ad2b4d', step_number: 4, name: '演习常态化', promise: null, status: null },
      ] });
    const res = await request(makeApp()).get(`/api/brain/golden-paths/${GP_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.golden_path.steps_count).toBe(4);
    expect(res.body.golden_path.steps).toHaveLength(4);
    const step2 = res.body.golden_path.steps.find(s => s.id === STEP_ID);
    expect(step2).toBeDefined();
    expect(step2.name).toBe('部署被证明没坏');
  });

  it('GP 不存在 → 404', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/golden-paths/no-such-gp');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('GP 有 journey_id 但 steps_count=0 → warn 并返回 steps_count=0（防御 fail-loud）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: GP_ID, journey_id: JOURNEY_ID, status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get(`/api/brain/golden-paths/${GP_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.golden_path.steps_count).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('steps_count=0'));
    warnSpy.mockRestore();
  });

  it('GP 无 journey_id → steps_count=0 且不查 journey_steps 表', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: GP_ID, journey_id: null, status: 'candidate' }] });
    const res = await request(makeApp()).get(`/api/brain/golden-paths/${GP_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.golden_path.steps_count).toBe(0);
    expect(res.body.golden_path.steps).toEqual([]);
    // 只查了 golden_paths 表，未查 journey_steps
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
