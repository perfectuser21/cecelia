/**
 * 迁移 533 的行为（scratch/CI 测试库）：在一个事务里铺一份与生产同 id 的获客夹具 → 跑迁移正文 → 断言 → 跑回滚正文 → 断言还原 → 整体 ROLLBACK。
 * 测试库没有生产数据，迁移本身在 migrate 时是空操作；这里验证的是对真实形状数据的效果。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const body = file => readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8')
  .split('\n').filter(line => !/^\s*(BEGIN|COMMIT);\s*$/.test(line)).join('\n');
const UP = body('533_leadgen_restructure.sql'), DOWN = body('rollback/533_leadgen_restructure.down.sql');
const VS = '0f533000-0000-4000-8000-000000000001', KW = 'a1000000-0000-4000-8000-000000000001', BM = 'a1000000-0000-4000-8000-000000000002';
const LINK = '5265cb99-ca28-45a8-9c33-6d63124bda96', LIVE = 'cc21a3c0-cd97-4b14-8cc9-7d90a3267353';
const OLD_KW_WF = 'b1000000-0000-4000-8000-000000000001', OLD_BM_WF = 'b1000000-0000-4000-8000-000000000002';
const ACT = { preflight: 'd27e18c9-709f-4c44-899c-85d6fb83671b', qualification: '27973f66-3033-4127-82d2-6248443e739b',
  collection: '9b8988e9-a22d-483c-a101-8091728b9e04', scoring: '81e8a55f-1939-454c-b61b-f320055ee5d5', outreach: 'bb4fdc47-a543-4374-9078-8e78151b69c6',
  cleanup: 'db4d47e2-2533-4152-adf7-e0f492ec1d47' };

let client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  await client.query('BEGIN');
  await client.query("INSERT INTO value_streams (id, name) VALUES ($1, '客户智能获客路径')", [VS]);
  await client.query(`INSERT INTO capabilities (id, name, description, status, parent_journey_id) VALUES
    ($1,'关键词获客','按关键词搜视频','active',$5),($2,'对标获客','按对标账号','active',$5),($3,'视频链接获客',NULL,'active',$5),($4,'直播获客','','active',$5)`, [KW, BM, LINK, LIVE, VS]);
  await client.query(`INSERT INTO workflows (id, capability_id, key, name, channel, form, status) VALUES
    ($1,$2,'douyin_keyword_leadgen_t533','抖音·关键词获客','douyin','android_rpa','active'),($3,$4,'douyin_benchmark_leadgen_t533','抖音·对标获客','douyin','android_rpa','active')`, [OLD_KW_WF, KW, OLD_BM_WF, BM]);
  for (const [key, id] of Object.entries(ACT)) {
    await client.query(`INSERT INTO activities (id, name, status, capability_key, activity_key, executor_kind, promise, inputs, contract, contract_sha256)
      VALUES ($1,$2,'planned','keyword_acquisition',$3,'code','旧承诺','[{"type":"Old"}]','{"name":"旧"}','sha-old')`, [id, `旧-${key}`, key]);
    await client.query("INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no) VALUES ($1,$2,$3,$4)", [OLD_KW_WF, key, id, Object.keys(ACT).indexOf(key) + 1]);
  }
  await client.query("INSERT INTO steps (activity_id, step_order, key, activity_key) VALUES ($1, 1, 'keyword_acquisition.cleanup.close_app_t533', 'cleanup')", [ACT.cleanup]);
  const entries = [[321856, 'commander-定时发起-悦升', true], [508370, 'harvest-cron 保底 @22:15', true], [508368, 'outreach-tick.sh', true],
    [545628, 'escort-xian-m4-cmd10050201', true], [64601, '获客判定抽查(质检)', true], [404564, 'escort-xian-m4-cmd10020630', false], [508389, 'leadgen-lock-reaper', false]];
  for (const [id, label, enabled] of entries) {
    await client.query("INSERT INTO ops_schedule_entries (id, source, host_alias, label, kind, enabled, workflow_id, updated_at) VALUES ($1,'t533','h',$2,'crontab',$3,$4,'2026-10-01T00:00:00Z')", [id, label, enabled, OLD_KW_WF]);
  }
});
afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.end(); } });

const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;

describe('迁移 533：获客重组（夹具上跑正文与回滚）', () => {
  it('正文：能力改名/废弃、四条新流程与引用、复用 Activity 改名换合同、闹钟改挂；旧流程/契约/Step 不动', async () => {
    await client.query(UP);
    expect(await one('SELECT name, status FROM capabilities WHERE id=$1', [KW])).toEqual({ name: '智能获客', status: 'active' });
    for (const id of [BM, LINK, LIVE]) {
      const c = await one('SELECT status, description FROM capabilities WHERE id=$1', [id]);
      expect(c.status).toBe('deprecated'); expect(c.description.startsWith('已并入智能获客，作为发现的找法。')).toBe(true);
    }
    expect((await one('SELECT description FROM capabilities WHERE id=$1', [LIVE])).description).toBe('已并入智能获客，作为发现的找法。');
    const flows = await all("SELECT name, channel, status, source_repo FROM workflows WHERE capability_id=$1 AND id::text LIKE 'b1000000-0000-4000-8000-0000000001%' ORDER BY key", [KW]);
    expect(flows.map(f => f.name).sort()).toEqual(['抖音·线索触达', '抖音·视频发现', '抖音·视频处理', '抖音·评论评分'].sort());
    expect(flows.every(f => f.channel === 'douyin' && f.source_repo === null)).toBe(true);
    const path = async key => (await all(`SELECT a.name FROM workflow_activity_refs r JOIN workflows w ON w.id=r.workflow_id JOIN activities a ON a.id=r.activity_id
      WHERE w.key=$1 AND r.active ORDER BY r.sequence_no`, [key])).map(r => r.name);
    expect(await path('douyin_video_discovery')).toEqual(['预检', '取源', '过滤去重', '取链接写视频表', '收尾']);
    expect(await path('douyin_video_processing')).toEqual(['预检', '判定视频', '采集评论', '收尾']);
    expect(await path('douyin_comment_scoring')).toEqual(['评分', '标记人']);
    expect(await path('douyin_lead_outreach')).toEqual(['预检', '发私信', '回填', '收尾']);
    const judge = await one('SELECT name, promise, inputs, contract, contract_sha256 FROM activities WHERE id=$1', [ACT.qualification]);
    expect(judge.name).toBe('判定视频'); expect(judge.promise).toContain('待判定');
    expect(judge.inputs[0].fields).toContain('judgment_status=待判定');
    expect(judge.contract).toEqual({ name: '旧' }); expect(judge.contract_sha256).toBe('sha-old');
    expect(await path('douyin_keyword_leadgen_t533')).toEqual(['预检', '判定视频', '采集评论', '评分', '发私信', '旧-cleanup']);
    expect(await one('SELECT name, status, capability_id FROM workflows WHERE id=$1', [OLD_BM_WF])).toEqual({ name: '抖音·对标获客', status: 'active', capability_id: BM });
    expect((await one("SELECT activity_id FROM steps WHERE key='keyword_acquisition.cleanup.close_app_t533'")).activity_id).toBe(ACT.cleanup);
    const wf = Object.fromEntries((await all('SELECT id::int, workflow_id::text, updated_at FROM ops_schedule_entries WHERE source=$1', ['t533'])).map(r => [r.id, r]));
    expect(wf[321856].workflow_id).toBe('b1000000-0000-4000-8000-000000000101');
    expect(wf[508370].workflow_id).toBe('b1000000-0000-4000-8000-000000000101');
    expect(wf[508368].workflow_id).toBe('b1000000-0000-4000-8000-000000000104');
    expect(wf[545628].workflow_id).toBeNull(); expect(wf[64601].workflow_id).toBeNull();
    expect(wf[404564].workflow_id).toBe(OLD_KW_WF); expect(wf[508389].workflow_id).toBe(OLD_KW_WF);
    expect(new Date(wf[321856].updated_at).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('重跑正文是空操作（幂等），备份只记第一次的原值', async () => {
    await client.query(UP);
    expect((await one('SELECT count(*)::int AS n FROM workflows WHERE capability_id=$1', [KW])).n).toBe(5);
    expect((await one("SELECT row->>'name' AS name FROM migration_533_backup WHERE kind='activity' AND id=$1", [ACT.qualification])).name).toBe('旧-qualification');
  });

  it('回滚：能力/Activity/闹钟按备份还原，新流程与新 Activity 删除', async () => {
    await client.query(DOWN);
    expect(await one('SELECT name, status, description FROM capabilities WHERE id=$1', [KW])).toEqual({ name: '关键词获客', status: 'active', description: '按关键词搜视频' });
    expect(await one('SELECT status, description FROM capabilities WHERE id=$1', [LINK])).toEqual({ status: 'active', description: null });
    const judge = await one('SELECT name, promise, inputs, readback FROM activities WHERE id=$1', [ACT.qualification]);
    expect(judge).toEqual({ name: '旧-qualification', promise: '旧承诺', inputs: [{ type: 'Old' }], readback: null });
    expect((await one("SELECT count(*)::int AS n FROM workflows WHERE id::text LIKE 'b1000000-0000-4000-8000-0000000001%'")).n).toBe(0);
    expect((await one("SELECT count(*)::int AS n FROM activities WHERE id::text LIKE 'c1000000-0000-4000-8000-0000000001%'")).n).toBe(0);
    const wf = await all('SELECT workflow_id::text FROM ops_schedule_entries WHERE source=$1', ['t533']);
    expect(wf.every(r => r.workflow_id === OLD_KW_WF)).toBe(true);
    expect((await one("SELECT to_regclass('migration_533_backup') AS t")).t).toBeNull();
  });
});
