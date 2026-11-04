import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const boundary = vi.hoisted(() => ({query: vi.fn(), connect: vi.fn(), briefing: vi.fn(), external: vi.fn()}));
vi.mock('../../db.js', () => ({default: {query: boundary.query, connect: boundary.connect}}));
vi.mock('../../focus.js', () => ({getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn()}));
vi.mock('../../tick.js', () => ({getTickStatus: vi.fn()}));
vi.mock('../../lib/task-type-registry.js', () => ({HARNESS_PIPELINE_LIST_STAGE_ORDER: [], HARNESS_PIPELINE_LIST_STAGE_LABELS: {}}));
vi.mock('../shared.js', () => ({getActivePolicy: vi.fn(), getWorkingMemory: vi.fn(), getTopTasks: vi.fn(), getRecentDecisions: vi.fn(), IDEMPOTENCY_TTL: 0, ALLOWED_ACTIONS: {}}));
vi.mock('../../nightly-orchestrator.js', () => ({getNightlyOrchestratorStatus: vi.fn()}));
vi.mock('../../websocket.js', () => ({default: {broadcast: boundary.external}, WS_EVENTS: {DESIRE_EXPRESSED: 'owned-event'}}));
vi.mock('../../selfcheck.js', () => ({EXPECTED_SCHEMA_VERSION: 'owned-schema'}));
vi.mock('../../lib/task-list-query.js', () => ({parseTaskListQuery: vi.fn()}));
// 真实src/briefing身份；不把mock挂到不存在的routes/briefing而掩盖500。
vi.mock('../../briefing.js', () => ({getBriefing: boundary.briefing}));
import router from '../status.js';
const app = express().use('/api/brain', router);
const value = {greeting: 'owned-fixture', since_last_visit: {completed: 3, events: []}, today_focus: null, pending_decisions: []};
beforeEach(() => {
  vi.resetAllMocks(); boundary.briefing.mockResolvedValue(value);
  for (const fn of [boundary.query, boundary.connect, boundary.external]) fn.mockImplementation(() => {throw Error('external boundary forbidden');});
  vi.stubGlobal('fetch', boundary.external);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(boundary.query).not.toHaveBeenCalled();expect(boundary.connect).not.toHaveBeenCalled();expect(boundary.external).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe('现役CeceliaPage简报真实注册HTTP入口', () => {
  it.each([['', undefined], ['?since=2026-11-04T00%3A00%3A00Z', '2026-11-04T00:00:00Z']])('规范getter收到原参数并返回原简报封套%s', async (suffix, since) => {
    const response = await request(app).get('/api/brain/briefing' + suffix);
    expect(response.status).toBe(200);expect(response.body).toEqual(value);
    expect(boundary.briefing).toHaveBeenCalledExactlyOnceWith({since});
  });
  it('getter失败仍诚实500，不能吞错/返回默认成功简报', async () => {
    boundary.briefing.mockRejectedValueOnce(Error('owned-briefing-failure'));
    const response = await request(app).get('/api/brain/briefing');
    expect(response.status).toBe(500);expect(response.body).toEqual({error: 'owned-briefing-failure'});
    expect(boundary.briefing).toHaveBeenCalledExactlyOnceWith({since: undefined});
  });
});
