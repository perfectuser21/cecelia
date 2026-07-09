/**
 * POST /tasks journey_id 顶层参数合并测试
 * 验证顶层 journey_id 被正确合并进 payload，以便 warroom 查询能找到任务。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../domain-detector.js', () => ({
  detectDomain: () => ({ domain: 'growth' }),
}));

vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(),
  FAILURE_CLASS: { NETWORK: 'network' },
}));

const { default: router } = await import('../routes/task-tasks.js');

function findPostHandler() {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === '/' && layer.route.methods.post) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error('POST / handler not found');
}

const postHandler = findPostHandler();

function makeRes() {
  const res = {
    _status: 200,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data) { this._json = data; return this; },
  };
  return res;
}

const FAKE_TASK = { id: 'abc', title: 'test', status: 'queued', task_type: 'dev', priority: 'P2' };

describe('POST /tasks — journey_id 合并进 payload', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [FAKE_TASK] });
  });

  it('顶层 journey_id 合并进 payload，存入 DB', async () => {
    const req = {
      body: {
        title: '测试任务',
        journey_id: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
      },
    };
    const res = makeRes();
    await postHandler(req, res);

    expect(res._status).toBe(201);
    const callArgs = mockQuery.mock.calls[0];
    const payloadArg = callArgs[1][8]; // payload is $9 (index 8)
    const parsed = JSON.parse(payloadArg);
    expect(parsed.journey_id).toBe('bb8cc561-b3ee-4fec-b74d-2255694bd963');
  });

  it('顶层 journey_id 与已有 payload 字段合并（不覆盖其他字段）', async () => {
    const req = {
      body: {
        title: '测试任务',
        journey_id: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
        payload: { executor: 'claude', orchestrator: 'skill-relay' },
      },
    };
    const res = makeRes();
    await postHandler(req, res);

    expect(res._status).toBe(201);
    const callArgs = mockQuery.mock.calls[0];
    const payloadArg = callArgs[1][8];
    const parsed = JSON.parse(payloadArg);
    expect(parsed.journey_id).toBe('bb8cc561-b3ee-4fec-b74d-2255694bd963');
    expect(parsed.executor).toBe('claude');
  });

  it('payload 内已有 journey_id 时不受顶层影响（无顶层时原样保留）', async () => {
    const req = {
      body: {
        title: '测试任务',
        payload: { journey_id: 'existing-id', executor: 'claude' },
      },
    };
    const res = makeRes();
    await postHandler(req, res);

    expect(res._status).toBe(201);
    const callArgs = mockQuery.mock.calls[0];
    const payloadArg = callArgs[1][8];
    const parsed = JSON.parse(payloadArg);
    expect(parsed.journey_id).toBe('existing-id');
  });

  it('未提供 journey_id 时 payload 为 null（无 payload 字段时）', async () => {
    const req = {
      body: { title: '测试任务' },
    };
    const res = makeRes();
    await postHandler(req, res);

    expect(res._status).toBe(201);
    const callArgs = mockQuery.mock.calls[0];
    const payloadArg = callArgs[1][8];
    expect(payloadArg).toBeNull();
  });
});
