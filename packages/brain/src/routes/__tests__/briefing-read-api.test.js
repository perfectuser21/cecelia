import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const boundary = vi.hoisted(() => ({query: vi.fn(), connect: vi.fn(), briefing: vi.fn(), external: vi.fn(), cooldown: vi.fn(), generate: vi.fn(), broadcast: vi.fn()}));
vi.mock('../../db.js', () => ({default: {query: boundary.query, connect: boundary.connect}}));
vi.mock('../../focus.js', () => ({getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn()}));
vi.mock('../../tick.js', () => ({getTickStatus: vi.fn()}));
vi.mock('../../lib/task-type-registry.js', () => ({HARNESS_PIPELINE_LIST_STAGE_ORDER: [], HARNESS_PIPELINE_LIST_STAGE_LABELS: {}}));
vi.mock('../shared.js', () => ({getActivePolicy: vi.fn(), getWorkingMemory: vi.fn(), getTopTasks: vi.fn(), getRecentDecisions: vi.fn(), IDEMPOTENCY_TTL: 0, ALLOWED_ACTIONS: {}}));
vi.mock('../../nightly-orchestrator.js', () => ({getNightlyOrchestratorStatus: vi.fn()}));
vi.mock('../../websocket.js', () => ({default: {broadcast: boundary.broadcast}, WS_EVENTS: {DESIRE_EXPRESSED: 'owned-event'}}));
vi.mock('../../selfcheck.js', () => ({EXPECTED_SCHEMA_VERSION: 'owned-schema'}));
vi.mock('../../lib/task-list-query.js', () => ({parseTaskListQuery: vi.fn()}));
// 真实src/briefing身份；不把mock挂到不存在的routes/briefing而掩盖500。
vi.mock('../../briefing.js', () => ({getBriefing: boundary.briefing}));
vi.mock('../../greet.js', () => ({isInCooldown: boundary.cooldown, generateGreeting: boundary.generate}));
import router from '../status.js';
const app = express().use('/api/brain', router);
const value = {greeting: 'owned-fixture', since_last_visit: {completed: 3, events: []}, today_focus: null, pending_decisions: []};
let expectedQueries = 0;
beforeEach(() => {
  vi.resetAllMocks(); expectedQueries = 0; boundary.briefing.mockResolvedValue(value);
  boundary.cooldown.mockResolvedValue(false);
  boundary.generate.mockResolvedValue({message: 'owned-greeting', type: 'inform', urgency: 3});
  for (const fn of [boundary.query, boundary.connect, boundary.external]) fn.mockImplementation(() => {throw Error('external boundary forbidden');});
  vi.stubGlobal('fetch', boundary.external);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  expect(boundary.query).toHaveBeenCalledTimes(expectedQueries);expect(boundary.connect).not.toHaveBeenCalled();expect(boundary.external).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe('现役CeceliaPage简报真实注册HTTP入口', () => {
  it.each([['', undefined], ['?since=2026-11-04T00%3A00%3A00Z', '2026-11-04T00:00:00Z']])('规范getter收到原参数并返回原简报封套%s', async (suffix, since) => {
    const response = await request(app).get('/api/brain/briefing' + suffix);
    expect(response.status).toBe(200);expect(response.body).toEqual(value);
    expect(boundary.briefing).toHaveBeenCalledTimes(1); expect(boundary.briefing).toHaveBeenCalledWith({since});
  });
  it('getter失败仍诚实500，不能吞错/返回默认成功简报', async () => {
    boundary.briefing.mockRejectedValueOnce(Error('owned-briefing-failure'));
    const response = await request(app).get('/api/brain/briefing');
    expect(response.status).toBe(500);expect(response.body).toEqual({error: 'owned-briefing-failure'});
    expect(boundary.briefing).toHaveBeenCalledTimes(1); expect(boundary.briefing).toHaveBeenCalledWith({since: undefined});
  });
});

describe('现役CeceliaPage主动问候入口的模块身份', () => {
  it('冷却期只更新presence，不生成/推送问候', async () => {
    expectedQueries = 1; boundary.query.mockResolvedValue({rows: []}); boundary.cooldown.mockResolvedValue(true);
    const response = await request(app).post('/api/brain/greet');
    expect(response.status).toBe(200); expect(response.body.status).toBe('cooldown');
    expect(boundary.cooldown).toHaveBeenCalledTimes(1); expect(boundary.cooldown).toHaveBeenCalledWith();
    expect(boundary.query.mock.calls[0][0]).toContain("'user_last_seen'");
    expect(boundary.generate).not.toHaveBeenCalled(); expect(boundary.broadcast).not.toHaveBeenCalled();
  });
  it('非冷却期调用真实模块身份的生成边界并推送原事件封套', async () => {
    const response = await request(app).post('/api/brain/greet');
    expect(response.status).toBe(200); expect(response.body).toEqual({status: 'generating'});
    await vi.waitFor(() => expect(boundary.broadcast).toHaveBeenCalledTimes(1));
    expect(boundary.generate).toHaveBeenCalledTimes(1); expect(boundary.generate).toHaveBeenCalledWith();
    expect(boundary.broadcast).toHaveBeenCalledWith('owned-event', expect.objectContaining({
      type: 'inform', urgency: 3, content: 'owned-greeting', message: 'owned-greeting', source: 'greet',
    }));
  });
  it('冷却查询失败在响应前返回500，不启动生成', async () => {
    boundary.cooldown.mockRejectedValueOnce(Error('owned-cooldown-failure'));
    const response = await request(app).post('/api/brain/greet');
    expect(response.status).toBe(500); expect(response.body).toEqual({error: 'owned-cooldown-failure'});
    expect(boundary.generate).not.toHaveBeenCalled(); expect(boundary.broadcast).not.toHaveBeenCalled();
  });
  it('生成无结果仍保留异步generating回执，不推送伪造问候', async () => {
    boundary.generate.mockResolvedValueOnce(null);
    const response = await request(app).post('/api/brain/greet');
    expect(response.status).toBe(200); expect(response.body).toEqual({status: 'generating'});
    expect(boundary.generate).toHaveBeenCalledTimes(1); expect(boundary.generate).toHaveBeenCalledWith(); expect(boundary.broadcast).not.toHaveBeenCalled();
  });
});
