/**
 * captures API 真实路由 + 私有 PG 集成回归
 * task_id: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
 * 覆盖: FR-3, FR-8
 */

import { beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { pool, openFixture, closeFixture } from '../../__tests__/helpers/debt-11-pg.js';
vi.mock('../../db.js', async () => ({ default: (await import('../../__tests__/helpers/debt-11-pg.js')).pool }));
const mockCreateRoutedTask = vi.hoisted(() => vi.fn());
// 本文件核Atom事务与实际PG状态；目标建单边界record-only，绝不调用模型/生产路由。
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: mockCreateRoutedTask }));
let server;
let BRAIN_URL;
let captureId, atomId;
beforeAll(async () => {
  await openFixture('captures', ['000_base_schema.sql', '198_captures_table.sql', '199_capture_atoms_events.sql', '354_captures_envelope_fields.sql', '355_capture_atoms_envelope_fields.sql', '385_capture_destination_link.sql'], `
    CREATE TABLE objectives(id uuid PRIMARY KEY);
    CREATE TABLE key_results(id uuid PRIMARY KEY);
    CREATE TABLE okr_projects(id uuid PRIMARY KEY);
    CREATE TABLE journeys(id uuid PRIMARY KEY);
  `);
  const app = express();
  app.use(express.json());
  app.use('/api/brain/captures', (await import('../captures.js')).default);
  app.use('/api/brain/capture-atoms', (await import('../capture-atoms.js')).default);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  BRAIN_URL = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await closeFixture();
});



beforeEach(async () => {
  mockCreateRoutedTask.mockReset().mockResolvedValue({ task_id: '11111111-2222-4333-8444-555555555555' });
  await pool.query('TRUNCATE captures CASCADE');
  const { rows } = await pool.query(`INSERT INTO captures(content,source,status,nature) VALUES
    ('seed captured','harness','captured',NULL), ('seed learning','harness','clarified','learning') RETURNING id`);
  captureId = rows[0].id;
  const { rows: atoms } = await pool.query(`INSERT INTO capture_atoms(capture_id,content,target_type,status,ai_reason,retry_count)
    VALUES ($1,'seed atom','task','parked','previous AI reason',2) RETURNING id`, [captureId]);
  atomId = atoms[0].id;
});

describe('POST /api/brain/captures', () => {
  const BASE_BODY = { content: 'unit test content', source: 'harness' };

  it('应返回 201 + {id, status, dedupe_key}', async () => {
    const dedupe = `unit-test-${Date.now()}`;
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, dedupe_key: dedupe }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.id).toBeTruthy();
    expect(data.status).toBe('captured'); // 无 nature → captured
    expect(data.dedupe_key).toBe(dedupe);
  });

  it('有 nature=learning → status=clarified', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, nature: 'learning', dedupe_key: `unit-learning-${Date.now()}` }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.status).toBe('clarified');
  });

  it('有 nature=issue → status=clarified', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, nature: 'issue', dedupe_key: `unit-issue-${Date.now()}` }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.status).toBe('clarified');
  });

  it('有 nature=handoff → status=clarified', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, nature: 'handoff', dedupe_key: `unit-handoff-${Date.now()}` }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.status).toBe('clarified');
  });

  it('dedupe_key 重复 → 200 + dedupe_hit=true', async () => {
    const dedupe = `dedupe-test-${Date.now()}`;
    // 首次写入
    await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, dedupe_key: dedupe }),
    });
    // 重复写入
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, dedupe_key: dedupe }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.dedupe_hit).toBe(true);
  });

  it('content 为空 → 400', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '', source: 'harness' }),
    });
    expect(resp.status).toBe(400);
  });

  it('source 不在白名单 → 400', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test', source: 'unknown' }),
    });
    expect(resp.status).toBe(400);
  });

  it('nature 不合法 → 400', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test', source: 'harness', nature: 'invalid' }),
    });
    expect(resp.status).toBe(400);
  });
});

describe('GET /api/brain/captures', () => {
  it('返回 items + total + counts_by_stage', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures?limit=5`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe('number');
    expect(data.counts_by_stage).toBeDefined();
    expect(typeof data.counts_by_stage.captured).toBe('number');
    expect(typeof data.counts_by_stage.clarified).toBe('number');
    expect(typeof data.counts_by_stage.done).toBe('number');
    expect(typeof data.counts_by_stage.dropped).toBe('number');
  });

  it('stage 过滤有效', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures?stage=captured&limit=10`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.items.length).toBeGreaterThan(0);
    for (const item of data.items) {
      expect(item.status).toBe('captured');
    }
  });

  it('nature 过滤有效', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures?nature=learning&limit=10`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.items.length).toBeGreaterThan(0);
    for (const item of data.items) {
      expect(item.nature).toBe('learning');
    }
  });
});

describe('GET /api/brain/captures/:id', () => {
  it('返回详情 + atoms 数组 + backlinks', async () => {
    const id = captureId;
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures/${id}`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.id).toBe(id);
    expect(data.atoms.map(atom => atom.id)).toContain(atomId);
    expect(Array.isArray(data.backlinks)).toBe(true);
  });
});

describe('PATCH /api/brain/capture-atoms/:id/confirm', () => {
  it('action:reroute 清空 ai_reason', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/capture-atoms/${atomId}/confirm`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reroute', target_type: 'knowledge' }),
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ id: atomId, status: 'pending_review', ai_reason: null, target_type: 'knowledge' });
    const { rows } = await pool.query('SELECT status, ai_reason, target_type FROM capture_atoms WHERE id=$1', [atomId]);
    expect(rows[0]).toEqual({ status: 'pending_review', ai_reason: null, target_type: 'knowledge' });
  });

  it('action:drop → status=dropped', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/capture-atoms/${atomId}/confirm`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'drop' }),
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ id: atomId, status: 'dropped' });
    const { rows } = await pool.query('SELECT status FROM capture_atoms WHERE id=$1', [atomId]);
    expect(rows[0].status).toBe('dropped');
  });
});

describe('POST /api/brain/capture-atoms/:id/retry', () => {
  it('retry_count + 1, status=pending_review', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/capture-atoms/${atomId}/retry`, { method: 'POST' });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ id: atomId, status: 'pending_review', retry_count: 3 });
    const { rows } = await pool.query('SELECT status, ai_reason, retry_count FROM capture_atoms WHERE id=$1', [atomId]);
    expect(rows[0]).toEqual({ status: 'pending_review', ai_reason: null, retry_count: 3 });
  });
});

describe('隔离数据上的拒绝边界', () => {
  it('非法 atom action 返回400且不改原行', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/capture-atoms/${atomId}/confirm`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invalid' }),
    });
    expect(resp.status).toBe(400);
    const { rows } = await pool.query('SELECT status, ai_reason FROM capture_atoms WHERE id=$1', [atomId]);
    expect(rows[0]).toEqual({ status: 'parked', ai_reason: 'previous AI reason' });
  });
  it('不存在的 capture 返回404', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures/00000000-0000-0000-0000-000000000000`);
    expect(resp.status).toBe(404);
  });
});


describe('UI实际Atom列表筛选与人工确认——私有PG读回', () => {
  it.each(['note', 'notes', 'handoff', 'legacy_custom'])('VARCHAR类型%s仍可精确筛选，不添加新枚举', async targetType => {
    const {rows:[expected]} = await pool.query("INSERT INTO capture_atoms(capture_id,content,target_type,status) VALUES($1,'owned type',$2,'pending_review') RETURNING id", [captureId,targetType]);
    const response = await fetch(`${BRAIN_URL}/api/brain/capture-atoms?target_type=${encodeURIComponent(targetType)}`);
    expect(response.status).toBe(200);expect((await response.json()).map(row=>row.id)).toEqual([expected.id]);
  });
  it('类型/status/capture筛选共同生效并保留降序分页', async () => {
    const {rows} = await pool.query(`INSERT INTO capture_atoms(capture_id,content,target_type,status,created_at) VALUES
      ($1,'first','knowledge','pending_review','2026-01-01T00:00:01Z'),
      ($1,'second','knowledge','pending_review','2026-01-01T00:00:02Z'),
      ($1,'other type','task','pending_review','2026-01-01T00:00:03Z') RETURNING id`,[captureId]);
    const response=await fetch(`${BRAIN_URL}/api/brain/capture-atoms?status=pending_review&target_type=knowledge&capture_id=${captureId}&limit=1&offset=1`);
    expect(response.status).toBe(200);expect((await response.json()).map(row=>row.id)).toEqual([rows[0].id]);
  });
  it('SQL片段作为普通筛选值，真实PG返回空且原记录保留', async () => {
    const response=await fetch(`${BRAIN_URL}/api/brain/capture-atoms?target_type=${encodeURIComponent("task' OR 1=1 --")}`);
    expect(response.status).toBe(200);expect(await response.json()).toEqual([]);
    expect((await pool.query('SELECT id FROM capture_atoms WHERE id=$1',[atomId])).rowCount).toBe(1);
  });
  it('PATCH/:id confirm真实持久化confirmed及路由引用，重复确认不重复委托', async () => {
    await pool.query("UPDATE capture_atoms SET status='pending_review' WHERE id=$1",[atomId]);
    const response=await fetch(`${BRAIN_URL}/api/brain/capture-atoms/${atomId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm'})});
    expect(response.status).toBe(200);const receipt=await response.json();
    expect(receipt).toEqual({id:atomId,status:'confirmed',routed_to_table:'tasks',routed_to_id:'11111111-2222-4333-8444-555555555555'});
    const {rows:[stored]}=await pool.query('SELECT status,routed_to_table,routed_to_id FROM capture_atoms WHERE id=$1',[atomId]);
    expect(stored).toEqual({status:'confirmed',routed_to_table:'tasks',routed_to_id:receipt.routed_to_id});
    expect((await pool.query('SELECT status FROM captures WHERE id=$1',[captureId])).rows[0].status).toBe('done');
    const duplicate=await fetch(`${BRAIN_URL}/api/brain/capture-atoms/${atomId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm'})});
    expect(duplicate.status).toBe(400);expect(mockCreateRoutedTask).toHaveBeenCalledTimes(1);
  });
  it('确认UPDATE后下游真实SQL失败，ROLLBACK恢复Atom及Capture旧状态', async () => {
    await pool.query("UPDATE capture_atoms SET status='pending_review' WHERE id=$1",[atomId]);
    await pool.query(`CREATE FUNCTION owned_reject_capture_done() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='done' THEN RAISE EXCEPTION 'owned_capture_done_rejected'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER owned_reject_capture_done BEFORE UPDATE ON captures FOR EACH ROW EXECUTE FUNCTION owned_reject_capture_done();`);
    try {
      const response=await fetch(`${BRAIN_URL}/api/brain/capture-atoms/${atomId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm'})});
      expect(response.status).toBe(500);expect((await response.json()).details).toContain('owned_capture_done_rejected');
      expect((await pool.query('SELECT status,routed_to_table,routed_to_id FROM capture_atoms WHERE id=$1',[atomId])).rows[0]).toEqual({status:'pending_review',routed_to_table:null,routed_to_id:null});
      expect((await pool.query('SELECT status FROM captures WHERE id=$1',[captureId])).rows[0].status).toBe('captured');
    } finally {
      await pool.query('DROP TRIGGER owned_reject_capture_done ON captures; DROP FUNCTION owned_reject_capture_done()');
    }
  });
});
