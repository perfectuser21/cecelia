import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({
  query: vi.fn(), llm: vi.fn(), forbidden: [],
  deny(kind) { this.forbidden.push(kind); throw Error('forbidden ' + kind); },
}));
vi.mock('../db.js', () => ({ default: { query: boundary.query } }));
vi.mock('../llm-caller.js', () => ({ callLLM: boundary.llm }));
vi.mock('child_process', () => ({ spawn: () => boundary.deny('spawn'), exec: () => boundary.deny('exec') }));
import { collectSelfReport, _resetTimer } from '../self-report-collector.js';
import router from '../routes/self-reports.js';

const tasks = [{ status: 'completed', cnt: 15 }, { status: 'queued', cnt: 5 }];
const desires = [{ type: 'inform', content: 'owned desire', urgency: 3 }];
let desiredRows;
let taskRows;
let suggestions;
let server;
beforeEach(() => {
  boundary.query.mockReset(); boundary.llm.mockReset(); boundary.forbidden.length = 0;
  desiredRows = []; taskRows = tasks; suggestions = [{ cnt: 29, max_score: 0.66 }];
  _resetTimer();
  boundary.llm.mockResolvedValue({ text: '<json>{"top_desire":"owned report","top_concerns":[],"self_rating":5}</json>' });
  boundary.query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM desires')) return { rows: desiredRows };
    if (sql.includes('FROM tasks')) return { rows: taskRows };
    if (sql.includes('FROM suggestions')) return { rows: suggestions };
    if (sql.includes('INSERT INTO self_reports')) {
      return { rows: [{ id: 'owned-report', signals_snapshot: JSON.parse(params[5]) }] };
    }
    return boundary.deny('unknown SQL');
  });
  vi.stubGlobal('fetch', () => boundary.deny('fetch'));
});
afterEach(async () => {
  if (server) { await new Promise(resolve => server.close(resolve)); server = undefined; }
  vi.unstubAllGlobals(); _resetTimer();
  expect(boundary.forbidden).toEqual([]);
});

function assertSnapshot(record, expected) {
  expect(record).not.toBeNull();
  expect(record.signals_snapshot).toEqual({ desires: desiredRows, task_stats: expected,
    suggestion_pending: 29, suggestion_max_score: 0.66 });
  const insert = boundary.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO self_reports'));
  expect(insert).toHaveLength(1);
  expect(JSON.parse(insert[0][1][5]).task_stats).toEqual(expected);
  expect(boundary.query).toHaveBeenCalledTimes(4);
  expect(boundary.llm).toHaveBeenCalledOnce();
  expect(boundary.llm.mock.calls[0][0]).toBe('mouth');
}

describe('真实fetchSignals通过collector的prompt和写入快照消费', () => {
  it.each([
    ['无desire但有task', [], tasks, { completed: 15, queued: 5 }],
    ['有desire且有task', desires, tasks, { completed: 15, queued: 5 }],
    ['有desire但无task', desires, [], {}],
    ['两者皆空', [], [], {}],
  ])('%s', async (_label, d, t, expected) => {
    desiredRows = d; taskRows = t;
    assertSnapshot(await collectSelfReport(), expected);
    const prompt = boundary.llm.mock.calls[0][1];
    expect(prompt).toContain(t.length ? '任务状态：completed: 15, queued: 5' : '任务状态：（无数据）');
    expect(prompt).toContain(d.length ? 'owned desire' : '（无 pending desires）');
    expect(prompt).toContain('待处理 suggestions：29 条，最高分 0.66');
  });
  it('任务查询失败保持原采集失败，不调用模型或写快照', async () => {
    boundary.query.mockImplementation(async sql => {
      if (sql.includes('FROM tasks')) throw Error('owned query failure');
      if (sql.includes('FROM desires') || sql.includes('FROM suggestions')) return { rows: [] };
      return boundary.deny('unexpected write');
    });
    expect(await collectSelfReport()).toBeNull();
    expect(boundary.llm).not.toHaveBeenCalled();
    expect(boundary.query).toHaveBeenCalledTimes(3);
  });
});

describe('当前公开POST /api/brain/self-reports/collect实际注册入口', () => {
  it.each([false, true])('空desire，任务为空=%s，真实HTTP保留snapshot', async emptyTasks => {
    taskRows = emptyTasks ? [] : tasks;
    const app = express(); app.use('/api/brain/self-reports', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const res = await request(server).post('/api/brain/self-reports/collect');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    assertSnapshot(res.body.record, emptyTasks ? {} : { completed: 15, queued: 5 });
  });
});
