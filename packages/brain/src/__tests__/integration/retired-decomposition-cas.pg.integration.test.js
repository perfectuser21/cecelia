/** 真实 SQL 使用连接专属临时表；专用 scratch 身份验证失败即拒绝。 */
import pg from 'pg';
import {it, expect} from 'vitest';
import {privatePgConfig, verifyPrivatePg} from '../../../../../scripts/ci/private-pg-contract.mjs';
import {parkRetiredDecomposition, parkClaimedRetiredDecomposition} from '../../lib/retired-decomposition.js';

it('仅停放未领取且类型与 payload 未变化的 queued 任务', async () => {
  const client = new pg.Client(privatePgConfig());
  await client.connect();
  let transaction = false;
  try {
    await verifyPrivatePg(client);
    await client.query('BEGIN'); transaction = true;
    await client.query(`CREATE TEMP TABLE tasks (
      id uuid, status text, task_type text, claimed_by text, claimed_at timestamptz, payload jsonb,
      blocked_at timestamptz, blocked_reason text, blocked_detail jsonb,
      blocked_until timestamptz, updated_at timestamptz
    )`);
    await client.query(`INSERT INTO tasks (id,status,task_type,claimed_by,payload) VALUES
      ('00000000-0000-4000-8000-000000000001','queued','dev',NULL,'{"decomposition":"true"}'),
      ('00000000-0000-4000-8000-000000000002','queued','dev','other','{"decomposition":"true"}'),
      ('00000000-0000-4000-8000-000000000003','queued','dev',NULL,'{"decomposition":"known"}'),
      ('00000000-0000-4000-8000-000000000004','in_progress','dev',NULL,'{"decomposition":"true"}'),
      ('00000000-0000-4000-8000-000000000005','queued','talk',NULL,'{"decomposition":"true"}')`);
    const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const task = n => ({id:id(n), task_type:'dev', payload:{decomposition:'true'}});
    for (const [n,expected] of [[1,true],[2,false],[3,false],[4,false],[5,false]]) {
      expect(await parkRetiredDecomposition(client,task(n))).toBe(expected);
    }
    const rows=(await client.query('SELECT id,status,claimed_by,blocked_reason FROM tasks ORDER BY id')).rows;
    expect(rows.find(row=>row.id===id(1))).toMatchObject({status:'blocked',blocked_reason:'retired_decomposition'});
    expect(rows.find(row=>row.id===id(4)).status).toBe('in_progress');
    expect(rows.find(row=>row.id===id(2)).claimed_by).toBe('other');
    const stamp='2026-11-07 00:00:00.123456+00';
    await client.query(`INSERT INTO tasks (id,status,task_type,claimed_by,claimed_at,payload) VALUES
      ($1,'in_progress','dev','old',$6,'{"decomposition":"true"}'),
      ($2,'in_progress','dev','new',$6,'{"decomposition":"true"}'),
      ($3,'in_progress','dev','old',($6::timestamptz + interval '1 microsecond'),'{"decomposition":"true"}'),
      ($4,'completed','dev','old',$6,'{"decomposition":"true"}'),
      ($5,'in_progress','dev','old',$6,'{"decomposition":"known"}')`,
      [id(6),id(7),id(8),id(9),id(10),stamp]);
    for (const [n,expected] of [[6,true],[7,false],[8,false],[9,false],[10,false]]) {
      expect(await parkClaimedRetiredDecomposition(client,task(n),'old',stamp)).toBe(expected);
    }
    const observed=(await client.query('SELECT id,status,claimed_by FROM tasks WHERE id=ANY($1::uuid[])',[ [id(6),id(7),id(8),id(9),id(10)] ])).rows;
    expect(observed.find(row=>row.id===id(6))).toMatchObject({status:'blocked',claimed_by:null});
    expect(observed.find(row=>row.id===id(7))).toMatchObject({status:'in_progress',claimed_by:'new'});
    expect(observed.find(row=>row.id===id(9)).status).toBe('completed');
    // 两类旧审核复用同一真实 CAS；内容变为计划调整或已被认领时不得停放。
    await client.query(`INSERT INTO tasks (id,status,task_type,claimed_by,payload) VALUES
      ($1,'queued','decomp_review',NULL,'{"review_scope":"decomposition_quality"}'),
      ($2,'queued','decomp_review',NULL,'{"review_scope":"plan_adjustment"}'),
      ($3,'queued','decomp_review','other','{"review_scope":"initiative_plan"}')`, [id(11),id(12),id(13)]);
    expect(await parkRetiredDecomposition(client,{id:id(11),task_type:'decomp_review',payload:{review_scope:'decomposition_quality'}})).toBe(true);
    expect(await parkRetiredDecomposition(client,{id:id(12),task_type:'decomp_review',payload:{review_scope:'decomposition_quality'}})).toBe(false);
    expect(await parkRetiredDecomposition(client,{id:id(13),task_type:'decomp_review',payload:{review_scope:'initiative_plan'}})).toBe(false);
  } finally {
    if (transaction) await client.query('ROLLBACK');
    await client.end();
  }
}, 15000);
