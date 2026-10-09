import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const clientQuery = vi.fn(async () => ({ rows: [] }));
const mockConnect = vi.fn(async () => ({ query: clientQuery, release: mockRelease }));
vi.mock('../../db.js', () => ({ default: { query: mockQuery, connect: mockConnect } }));

const { default: router } = await import('../agent-ops.js');

function app() {
  const a = express();
  a.use(express.json({ limit: '4mb' }));
  a.use('/agent-ops', router);
  return a;
}

const ITEM = { name: 'x-timer', host: 'nas', mech: 'systemd-timer', freq: '每天', en: '启用', node: '无', last: '', ok: '', st: '正常', note: '' };

describe('GET /agent-ops/alarms', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('200：返回 alarms + summary + sources', async () => {
    mockQuery.mockImplementation(async (sql) => (String(sql).includes('FROM ops_schedule_entries')
      ? { rows: [{ id: 1, source: 'brain', host_alias: 'us-vps', label: 'a', kind: 'brain_job', schedule_desc: '每 1 分钟', enabled: true, last_status: '正常', ledger_status: 'registered', journey_id: null }] }
      : { rows: [] }));
    const r = await request(app()).get('/agent-ops/alarms');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.alarms[0]).toMatchObject({ name: 'a', mechanism: 'brain-job', machine: 'us-vps' });
    expect(r.body.data.summary.total).toBe(1);
  });

  it('503 migration_pending：列不存在（517 未迁），不吐 200 空数组', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('column "ledger_status" does not exist'), { code: '42703' }));
    const r = await request(app()).get('/agent-ops/alarms');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('migration_pending');
  });
});

describe('POST /agent-ops/alarms/import', () => {
  const OLD = process.env.CECELIA_INTERNAL_TOKEN;
  beforeEach(() => {
    mockQuery.mockReset();
    clientQuery.mockClear();
    mockQuery.mockImplementation(async () => ({ rows: [] }));
    process.env.CECELIA_INTERNAL_TOKEN = 'secret-token';
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.CECELIA_INTERNAL_TOKEN; else process.env.CECELIA_INTERNAL_TOKEN = OLD;
  });

  it('无令牌 → 401（写入口不对外裸奔）', async () => {
    const r = await request(app()).post('/agent-ops/alarms/import').send({ items: [ITEM] });
    expect(r.status).toBe(401);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it('items 非数组/为空/超过 1000 条 → 400', async () => {
    const h = { Authorization: 'Bearer secret-token' };
    expect((await request(app()).post('/agent-ops/alarms/import').set(h).send({})).status).toBe(400);
    expect((await request(app()).post('/agent-ops/alarms/import').set(h).send({ items: [] })).status).toBe(400);
    expect((await request(app()).post('/agent-ops/alarms/import').set(h).send({ items: new Array(1001).fill(ITEM) })).status).toBe(400);
  });

  it('缺省干跑：不开事务、不写库；显式 dry_run:false 才写', async () => {
    const h = { Authorization: 'Bearer secret-token' };
    const dry = await request(app()).post('/agent-ops/alarms/import').set(h).send({ items: [ITEM] });
    expect(dry.status).toBe(200);
    expect(dry.body.data).toMatchObject({ dry_run: true, inserts: 1 });
    expect(mockConnect).not.toHaveBeenCalled();
    const real = await request(app()).post('/agent-ops/alarms/import').set(h).send({ items: [ITEM], dry_run: false });
    expect(real.status).toBe(200);
    expect(real.body.data).toMatchObject({ dry_run: false, inserts: 1 });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]).trim());
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });

  it('517 未迁（列不存在）→ 503，不是 500', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('x'), { code: '42703' }));
    const r = await request(app()).post('/agent-ops/alarms/import').set({ Authorization: 'Bearer secret-token' }).send({ items: [ITEM] });
    expect(r.status).toBe(503);
  });
});
