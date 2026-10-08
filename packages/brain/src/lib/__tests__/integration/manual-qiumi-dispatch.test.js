import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { dispatchManualQiumi, releaseQiumiClaim } from '../../manual-qiumi-dispatch.js';
import { PUSH_QIUMI_QUERY, pushQiumiStatus } from '../../../notion-gtd-sync.js';

// 私有测试 schema 只在 CI 测试库或本机 scratch；禁止触碰生产及现有业务表。
const dbName = process.env.DB_NAME || 'cecelia_scratch';
if (!/test|scratch/.test(dbName)) throw new Error('需要明确的测试库或 scratch 库');
const schema = `rpa_${randomUUID().replaceAll('-', '')}`;
const config = { host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
  database: dbName, user: process.env.DB_USER || 'cecelia', password: process.env.DB_PASSWORD || '' };
const a = new pg.Client(config); const b = new pg.Client(config);
const fixture = (id) => ({ id, title: '只读任务', task_type: 'qiumi_task', status: 'queued', payload: {} });
beforeAll(async () => {
  await a.connect(); await b.connect();
  await a.query(`CREATE SCHEMA ${schema}`);
  await a.query(`CREATE TABLE ${schema}.tasks (
    id text PRIMARY KEY, title text, task_type text, status text, payload jsonb DEFAULT '{}',
    claimed_by text, claimed_at timestamptz, updated_at timestamptz DEFAULT NOW(), started_at timestamptz,
    executor_kind text, metadata jsonb, result jsonb, notion_props jsonb DEFAULT '{}',
    error_message text, blocked_reason text, blocked_detail jsonb)`);
  await a.query(`SET search_path TO ${schema}`); await b.query(`SET search_path TO ${schema}`);
});
afterAll(async () => {
  await a.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  await Promise.all([a.end(), b.end()]);
});

describe('定向手机派发：真实双连接 PG', () => {
  it('同时请求只认领启动一次，并把路由保存的 run_id 交给执行器', async () => {
    const task = fixture('race');
    await a.query("INSERT INTO tasks(id,title,task_type,status) VALUES($1,$2,'qiumi_task','queued')", [task.id, task.title]);
    let starts = 0;
    const deps = (db) => ({
      route: async (claimed) => {
        expect(claimed.status).toBe('queued'); expect(claimed.claimed_by).toBeTruthy();
        await db.query("UPDATE tasks SET payload=$2::jsonb WHERE id=$1", [task.id, JSON.stringify({ run_id: 'same-run', qiumi_department: 'skill-factory' })]);
        return { outcome: 'proceed' };
      },
      trigger: async (started) => {
        starts++; expect(started.payload.run_id).toBe('same-run');
        return { success: true, runId: started.payload.run_id };
      },
    });
    const replies = await Promise.all([dispatchManualQiumi(task, a, deps(a)), dispatchManualQiumi(task, b, deps(b))]);
    expect(replies.map((r) => r.status).sort()).toEqual([202, 409]); expect(starts).toBe(1);
    const row = (await a.query('SELECT * FROM tasks WHERE id=$1', [task.id])).rows[0];
    expect(row.status).toBe('in_progress'); expect(row.executor_kind).toBe('openclaw-agent');
    expect(row.payload.run_id).toBe('same-run'); expect(row.claimed_by).toMatch(/^manual-qiumi:/);
  });
  it('旧 owner 清理不能移除新 owner 的 claim', async () => {
    await a.query("INSERT INTO tasks(id,status,claimed_by) VALUES('owner','queued','new-owner')");
    expect((await releaseQiumiClaim(b, 'owner', 'old-owner')).rowCount).toBe(0);
    expect((await a.query("SELECT claimed_by FROM tasks WHERE id='owner'")).rows[0].claimed_by).toBe('new-owner');
  });
  it('回执指纹真落库：同状态改原因或结果重推，stamp后不因updated_at变化循环重推', async () => {
    await a.query(`INSERT INTO tasks(id,task_type,status,payload,blocked_detail)
      VALUES('receipt','qiumi_task','blocked','{"notion_zh_page_id":"zh"}','{"message":"手机离线"}')`);
    const patches = [];
    const notionReq = async (_token, _path, method, data) => {
      if (method === 'PATCH') patches.push(data);
      return { properties: { 状态: { status: { name: '进行中' } } } };
    };
    expect((await pushQiumiStatus(a, 'test', { notionReq })).pushed).toBe(1);
    expect(patches[0].properties['OpenClaw结果'].rich_text[0].text.content).toContain('手机离线');
    await a.query("UPDATE tasks SET updated_at=NOW() WHERE id='receipt'");
    expect((await a.query(PUSH_QIUMI_QUERY)).rows).toHaveLength(0);
    await a.query(`UPDATE tasks SET blocked_detail='{"message":"微信未登录"}' WHERE id='receipt'`);
    expect((await pushQiumiStatus(a, 'test', { notionReq })).pushed).toBe(1);
    expect(patches.at(-1).properties['OpenClaw结果'].rich_text[0].text.content).toContain('微信未登录');
    await a.query(`UPDATE tasks SET result='{"summary":"新结果"}' WHERE id='receipt'`);
    expect((await a.query(PUSH_QIUMI_QUERY)).rows).toHaveLength(1);
  });
});
