import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const boundary = vi.hoisted(() => ({query: vi.fn(), external: vi.fn()}));
vi.mock('../../db.js', () => ({default: {query: boundary.query}}));
vi.mock('node:child_process', () => ({execSync: boundary.external, execFileSync: boundary.external, spawn: boundary.external}));
vi.mock('child_process', () => ({execSync: boundary.external, execFileSync: boundary.external, spawn: boundary.external}));
import {runPerception} from '../../desire/perception.js';
import router from '../perception-signals.js';
const app = express().use('/api/brain/perception-signals', router);
const NOW = Date.parse('2026-11-05T12:00:00Z');
let contactRows, contactFailure;
// 只提供数据库输入；联系时长与信号名由真实采集器产生，不复制业务算法。
function readFixture(sql) {
  if (!/^\s*SELECT\b/i.test(sql)) throw Error('database writes forbidden');
  if (sql.includes("key IN ('last_alex_chat_at', 'last_feishu_at')")) {
    if (contactFailure) throw Error('owned contact read failure');
    return {rows: contactRows};
  }
  if (sql.includes("key IN ('user_last_seen'")) return {rows: [{key: 'user_last_seen', value_json: '2026-11-05T11:59:00Z'}]};
  if (sql.includes('AS completed_24h')) return {rows: [{in_progress: '1', queued: '4', completed_24h: '6'}]};
  if (sql.includes('AS in_progress')) return {rows: [{completed: '6', failed: '2', queued: '4', in_progress: '1'}]};
  if (sql.includes('FROM key_results')) return {rows: [{title: 'owned KR', progress: '50', status: 'active', priority: 'P1'}]};
  if (sql.includes('FROM learnings')) return {rows: [{cnt: '2'}]};
  if (sql.includes('HAVING COUNT(*)')) return {rows: []};
  if (sql.includes("INTERVAL '7 days'")) return {rows: [{completed: '6', total: '10'}]};
  if (sql.includes('CURRENT_DATE')) return {rows: [{cnt: '6'}]};
  if (sql.includes('AS deep_count')) return {rows: [{deep_count: '1', total_count: '2'}]};
  if (sql.includes('FROM memory_stream')) return {rows: [{cnt: '1'}]};
  if (sql.includes("key = 'curiosity_topics'")) return {rows: []};
  if (sql.includes('MAX(created_at)')) return {rows: [{last_research: '2026-11-05T11:00:00Z'}]};
  throw Error('unrecognized owned SELECT: ' + sql);
}
beforeEach(() => {
  vi.resetAllMocks(); contactRows = []; contactFailure = false;
  boundary.query.mockImplementation(async sql => readFixture(sql));
  boundary.external.mockImplementation(() => {throw Error('external effect forbidden');});
  vi.stubGlobal('fetch', boundary.external);
  vi.spyOn(process, 'kill').mockImplementation(boundary.external);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  expect(boundary.external).not.toHaveBeenCalled();
  expect(boundary.query.mock.calls.every(([sql]) => /^\s*SELECT\b/i.test(sql))).toBe(true);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function signal(response, id) {
  expect(response.status).toBe(200);
  return response.body.signals.find(item => item.id === id);
}
describe('真实runPerception → 注册HTTP的公共联系信号兼容', () => {
  for (const [name, rows, expected] of [
    ['任意渠道取最近联系', [{key: 'last_alex_chat_at', value_json: '2026-11-05T09:30:00Z'}, {key: 'last_feishu_at', value_json: '2026-11-05T07:00:00Z'}], 2.5],
    ['仅飞书记录', [{key: 'last_feishu_at', value_json: '2026-11-05T08:00:00Z'}], 4],
    ['仅Alex记录', [{key: 'last_alex_chat_at', value_json: '2026-11-05T10:00:00Z'}], 2],
    ['没有记录保留999', [], 999],
    ['无效记录保留999', [{key: 'last_alex_chat_at', value_json: 'invalid-owned-date'}], 999],
  ]) it(name, async () => {
    contactRows = rows;
    const actual = (await runPerception({query: boundary.query})).find(item => item.signal === 'hours_since_alex_contact');
    expect(actual.value).toBe(expected);
    const response = await request(app).get('/api/brain/perception-signals');
    expect(signal(response, 'hours_since_feishu')).toEqual({
      id: 'hours_since_feishu', label: '距上次联系', importance: 6, hasConsumer: true,
      value: actual.value, context: actual.context, observed: true,
    });
    expect(response.body.signals).toHaveLength(16);
    expect(response.body.signals.some(item => item.id === 'hours_since_alex_contact')).toBe(false);
  });
  it('联系读取失败保持unknown，不伪造0或999', async () => {
    contactFailure = true;
    const response = await request(app).get('/api/brain/perception-signals');
    expect(signal(response, 'hours_since_feishu')).toMatchObject({value: null, context: null, observed: false});
  });
  it('其余公共信号原值、单位和缺失语义保持', async () => {
    const response = await request(app).get('/api/brain/perception-signals');
    for (const [id, value] of [
      ['task_fail_rate_24h', 0.25], ['queue_buildup', 4], ['kr_status_snapshot', [{title: 'owned KR', progress: 50}]],
      ['user_online', true], ['undigested_knowledge', 2], ['task_completed_today', 6], ['learning_gap_signal', 1],
    ]) expect(signal(response, id)).toMatchObject({value, observed: true});
    expect(signal(response, 'kr_stalled')).toMatchObject({value: null, context: null, observed: false});
    expect(new Date(response.body.snapshot_at).getTime()).not.toBeNaN();
  });
});
