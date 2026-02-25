/**
 * Work Streams API Route Tests
 * GET /api/brain/work/streams
 *
 * 路由使用 planner.js 的 selectTopAreas + selectActiveInitiativeForArea + ACTIVE_AREA_COUNT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => {
  const mockPool = { query: vi.fn() };
  return { default: mockPool };
});

vi.mock('../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
  getGlobalState: vi.fn(),
  scoreKRs: vi.fn(),
  selectTargetKR: vi.fn(),
  selectTargetProject: vi.fn(),
  generateNextTask: vi.fn(),
  buildLearningPenaltyMap: vi.fn().mockResolvedValue(new Map()),
  LEARNING_PENALTY_SCORE: 0,
  LEARNING_LOOKBACK_DAYS: 7,
  LEARNING_FAILURE_THRESHOLD: 3,
  CONTENT_SCORE_KNOWN_DECOMPOSITION_BONUS: 10,
  getPrPlansByInitiative: vi.fn().mockResolvedValue([]),
  isPrPlanCompleted: vi.fn(),
  updatePrPlanStatus: vi.fn(),
  canExecutePrPlan: vi.fn(),
  getNextPrPlan: vi.fn(),
  checkPrPlansCompletion: vi.fn(),
  ACTIVE_AREA_COUNT: 3,
  selectTopAreas: vi.fn(),
  selectActiveInitiativeForArea: vi.fn(),
}));

import pool from '../db.js';
import { getGlobalState, selectTopAreas, selectActiveInitiativeForArea } from '../planner.js';
import routes from '../routes.js';

function mockReqRes(params = {}, query = {}) {
  const req = { params, query };
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

function getHandler(method, path) {
  const layers = routes.stack.filter(
    l => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

function buildState({ objectives = [], keyResults = [], projects = [], activeTasks = [], recentCompleted = [], focus = null } = {}) {
  return { objectives, keyResults, projects, activeTasks, recentCompleted, focus };
}

const AREA_A = { id: 'area-a', type: 'area_okr', title: 'Cecelia AI', priority: 'P0', status: 'in_progress', progress: 45 };
const AREA_B = { id: 'area-b', type: 'area_okr', title: 'ZenithJoy', priority: 'P1', status: 'in_progress', progress: 20 };
const KR_A = { id: 'kr-a', type: 'area_kr', title: 'KR A', parent_id: 'area-a', priority: 'P0', status: 'in_progress', progress: 40 };
const INITIATIVE_A = { id: 'init-a', name: '实现 Parser API', status: 'active', created_at: '2026-01-01T00:00:00Z' };

describe('GET /work/streams', () => {
  const handler = getHandler('get', '/work/streams');

  beforeEach(() => { vi.clearAllMocks(); });

  it('空 state 时 streams 为空', async () => {
    getGlobalState.mockResolvedValue(buildState());
    selectTopAreas.mockReturnValue([]);
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.activeAreaCount).toBe(3);
    expect(res._data.streams).toEqual([]);
    expect(res._data.timestamp).toBeDefined();
    expect(selectTopAreas).toHaveBeenCalledWith(expect.any(Object), 3);
  });

  it('有一个 area（无 KR）时 activeInitiative 为 null', async () => {
    getGlobalState.mockResolvedValue(buildState({ objectives: [AREA_A] }));
    selectTopAreas.mockReturnValue([AREA_A]);
    selectActiveInitiativeForArea.mockReturnValue(null);
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._data.streams).toHaveLength(1);
    expect(res._data.streams[0].area.id).toBe('area-a');
    expect(res._data.streams[0].area.priority).toBe('P0');
    expect(res._data.streams[0].totalQueuedTasks).toBe(0);
    expect(res._data.streams[0].activeInitiative).toBeNull();
  });

  it('有 Initiative 时返回正确结构（lockReason: fifo）', async () => {
    const activeTasks = [
      { id: 't1', goal_id: 'kr-a', project_id: 'init-a', status: 'queued' },
      { id: 't2', goal_id: 'kr-a', project_id: 'init-a', status: 'queued' },
    ];
    getGlobalState.mockResolvedValue(buildState({ objectives: [AREA_A], keyResults: [KR_A], projects: [INITIATIVE_A], activeTasks }));
    selectTopAreas.mockReturnValue([AREA_A]);
    selectActiveInitiativeForArea.mockReturnValue({ initiative: INITIATIVE_A, kr: KR_A });
    const { req, res } = mockReqRes();
    await handler(req, res);
    const stream = res._data.streams[0];
    expect(stream.totalQueuedTasks).toBe(2);
    expect(stream.activeInitiative.initiative.id).toBe('init-a');
    expect(stream.activeInitiative.lockReason).toBe('fifo');
    expect(stream.activeInitiative.queuedTasks).toBe(2);
    expect(stream.activeInitiative.inProgressTasks).toBe(0);
  });

  it('有 in_progress 任务时 lockReason 为 in_progress', async () => {
    const activeTasks = [
      { id: 't1', goal_id: 'kr-a', project_id: 'init-a', status: 'in_progress' },
      { id: 't2', goal_id: 'kr-a', project_id: 'init-a', status: 'queued' },
    ];
    getGlobalState.mockResolvedValue(buildState({ objectives: [AREA_A], keyResults: [KR_A], projects: [INITIATIVE_A], activeTasks }));
    selectTopAreas.mockReturnValue([AREA_A]);
    selectActiveInitiativeForArea.mockReturnValue({ initiative: INITIATIVE_A, kr: KR_A });
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._data.streams[0].activeInitiative.lockReason).toBe('in_progress');
    expect(res._data.streams[0].activeInitiative.inProgressTasks).toBe(1);
    expect(res._data.streams[0].activeInitiative.queuedTasks).toBe(1);
  });

  it('最多返回 ACTIVE_AREA_COUNT 个 streams', async () => {
    const areas = [1,2,3].map(i => ({ id: `a-${i}`, type: 'area_okr', title: `A${i}`, priority: 'P1', status: 'in_progress', progress: 0 }));
    getGlobalState.mockResolvedValue(buildState({ objectives: areas }));
    selectTopAreas.mockReturnValue(areas);
    selectActiveInitiativeForArea.mockReturnValue(null);
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._data.streams.length).toBe(3);
  });

  it('两个 area 时按 selectTopAreas 顺序返回', async () => {
    getGlobalState.mockResolvedValue(buildState({ objectives: [AREA_A, AREA_B] }));
    selectTopAreas.mockReturnValue([AREA_A, AREA_B]);
    selectActiveInitiativeForArea.mockReturnValue(null);
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._data.streams[0].area.priority).toBe('P0');
    expect(res._data.streams[1].area.priority).toBe('P1');
  });

  it('getGlobalState 失败时返回 500', async () => {
    getGlobalState.mockRejectedValue(new Error('DB connection failed'));
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._data.error).toBe('Failed to get work streams');
    expect(res._data.details).toBe('DB connection failed');
  });

  it('kr.name 作为 kr.title 的 fallback', async () => {
    const krWithName = { id: 'kr-x', parent_id: 'area-a', name: 'KR by name', status: 'in_progress' };
    getGlobalState.mockResolvedValue(buildState({
      objectives: [AREA_A], keyResults: [krWithName], projects: [INITIATIVE_A],
      activeTasks: [{ id: 't1', goal_id: 'kr-x', project_id: 'init-a', status: 'queued' }],
    }));
    selectTopAreas.mockReturnValue([AREA_A]);
    selectActiveInitiativeForArea.mockReturnValue({ initiative: INITIATIVE_A, kr: krWithName });
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._data.streams[0].activeInitiative.kr.title).toBe('KR by name');
  });
});
