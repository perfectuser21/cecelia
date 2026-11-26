import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import request from 'supertest';
const boundary = vi.hoisted(() => ({query: vi.fn(), connect: vi.fn(), briefing: vi.fn(), external: vi.fn(), cooldown: vi.fn(), generate: vi.fn(), broadcast: vi.fn(), memory: vi.fn(), top: vi.fn(), decisions: vi.fn(), policy: vi.fn(), tick: vi.fn()}));
vi.mock('../../db.js', () => ({default: {query: boundary.query, connect: boundary.connect}}));
vi.mock('../../focus.js', () => ({getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn()}));
vi.mock('../../tick.js', () => ({getTickStatus: boundary.tick}));
vi.mock('../../lib/task-type-registry.js', () => ({HARNESS_PIPELINE_LIST_STAGE_ORDER: [], HARNESS_PIPELINE_LIST_STAGE_LABELS: {}}));
vi.mock('../shared.js', () => ({getActivePolicy: boundary.policy, getWorkingMemory: boundary.memory, getTopTasks: boundary.top, getRecentDecisions: boundary.decisions, IDEMPOTENCY_TTL: 0, ALLOWED_ACTIONS: {}}));
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


describe('旧夜间自动编排退役后的状态与历史读取', () => {
  it('真实状态HTTP保留disabled封套及现役队列统计，只读取普通任务统计', async () => {
    expectedQueries = 1;
    boundary.memory.mockResolvedValue({owned: true});
    boundary.top.mockResolvedValue([{id: 'queued-owned', priority: 'P1', status: 'queued'}]);
    boundary.decisions.mockResolvedValue([]); boundary.policy.mockResolvedValue({content_json: {owned: 'policy'}});
    boundary.tick.mockResolvedValue({actions_today: 7, last_tick: 'owned-tick', interval_minutes: 2});
    boundary.query.mockResolvedValue({rows: [{completed_today: '2', failed_today: '1', queued: '3', in_progress: '1'}]});
    const response = await request(app).get('/api/brain/status/full');
    expect(response.status).toBe(200);
    expect(response.body.nightly_orchestrator).toEqual({
      scheduler_running: false, in_night_window: false, night_window_utc: '20:00-8:00',
      cycle_count: 0, dispatched_tonight: 0, last_cycle_at: null, last_report_date: null, retired: true,
    });
    expect(response.body.task_stats).toEqual({completed_today: 2, failed_today: 1, queued: 3, in_progress: 1});
    expect(response.body.tick_stats).toEqual({actions_today: 7, last_tick_at: 'owned-tick', interval_minutes: 2});
    expect(response.body.top_tasks).toEqual([{id: 'queued-owned', priority: 'P1', status: 'queued'}]);
    expect(boundary.query.mock.calls[0][0]).toMatch(/^\s*SELECT[\s\S]*FROM tasks\s*$/);
  });
  it('真实历史HTTP与getter保留旧日报记录及日期类型过滤，不补写报告', async () => {
    expectedQueries = 1;
    const rows = [{id: 'historical', date: '2026-07-22', type: 'nightly_orchestration', summary: '{"dispatched":2}'}];
    boundary.query.mockResolvedValue({rows});
    const {getDailyReports} = await import('../../nightly-tick.js');
    // 只装配真实goals模块的只读历史路由；其余写入/外部诊断依赖不导入。
    const source = readFileSync(new URL('../goals.js', import.meta.url), 'utf8');
    const mounts = parse(source, {ecmaVersion: 'latest', sourceType: 'module'}).body.filter(node =>
      node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression'
      && node.expression.callee.type === 'MemberExpression' && node.expression.callee.object.name === 'router'
      && node.expression.callee.property.name === 'get' && node.expression.arguments[0]?.value === '/daily-reports/:date');
    const router = express.Router();
    new Function('router', 'getDailyReports', mounts.map(node => source.slice(node.start, node.end)).join('\n'))(router, getDailyReports);
    const history = express().use('/api/brain', router);
    const response = await request(history).get('/api/brain/daily-reports/2026-07-22?type=nightly_orchestration');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({success: true, date: '2026-07-22', type: 'nightly_orchestration', reports: rows});
    expect(boundary.query.mock.calls[0][0]).toMatch(/^\s*SELECT[\s\S]*FROM daily_logs[\s\S]*AND dl.type = \$2/);
    expect(boundary.query.mock.calls[0][1]).toEqual(['2026-07-22', 'nightly_orchestration']);
  });
});
