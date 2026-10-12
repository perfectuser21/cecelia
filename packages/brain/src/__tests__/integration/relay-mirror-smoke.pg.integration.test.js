import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';

const database = process.env.CI ? DB_DEFAULTS.database : 'cecelia_scratch';
if (!['localhost', '127.0.0.1', '::1', '/tmp', '/var/run/postgresql'].includes(DB_DEFAULTS.host)) {
  throw new Error('relay smoke 回归仅允许本地测试数据库');
}
const schema = `relay_mirror_${randomUUID().replaceAll('-', '')}`;
const client = new pg.Client({ ...DB_DEFAULTS, database });
const root = randomUUID(), child = randomUUID(), decision = randomUUID(), unrelated = randomUUID();
const brainDir = fileURLToPath(new URL('../../../', import.meta.url));

beforeAll(async () => {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`CREATE TABLE projects(id uuid PRIMARY KEY,name text,description text,status text,
    brief jsonb DEFAULT '{}',custom_props jsonb DEFAULT '{}',metadata jsonb,notion_props jsonb DEFAULT '{}',
    ai_tier text DEFAULT '知情',end_date date,updated_at timestamptz DEFAULT now());
    CREATE TABLE tasks(id uuid PRIMARY KEY,title text,status text,task_type text,project_id uuid,
      sequence_no integer,result jsonb,created_at timestamptz,completed_at timestamptz);
    CREATE TABLE decisions(id uuid PRIMARY KEY,topic text,decision text,reason text,status text,
      trigger text,context jsonb,priority text,created_at timestamptz,notion_id text,notion_synced_at timestamptz);`);
  await client.query(`INSERT INTO projects(id,name,description,status) VALUES($1,'smoke 项目','目标：看得见','in_progress'),
    ($2,'其他测试的数据','不可修改','in_progress')`, [root, unrelated]);
  await client.query(`INSERT INTO tasks(id,title,status,task_type,project_id,sequence_no,result)
    VALUES($1,'smoke 第一棒','completed','data',$2,1,
    '{"handoff_log":[{"at":"2026-09-23T00:00:00Z","title":"第一棒","verdict":"PASS","done":["铺了脊柱"]}]}')`, [child, root]);
  await client.query(`INSERT INTO decisions(id,topic,decision,status,trigger,context,priority)
    VALUES($1,'smoke 拍板','待定','pending','handoff',$2::jsonb,'P2')`,
  [decision, JSON.stringify({ project_id: root, task_id: child })]);
});
afterAll(async () => {
  await client.query('ROLLBACK');
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

it('执行 smoke 原始 Node 程序：完整投影、人工回灌、重复幂等且不改其他项目', async () => {
  const source = readFileSync(new URL('../../../scripts/smoke/relay-mirror-smoke.sh', import.meta.url), 'utf8');
  const program = source.match(/"\$NODE" --input-type=module -e "[\s\S]*?" \|\| fail "投影链路失败"/)?.[0];
  expect(program).toBeTruthy();
  const url = new URL(`postgresql://localhost:${DB_DEFAULTS.port}/${database}`);
  url.username = DB_DEFAULTS.user;
  if (DB_DEFAULTS.password) url.password = DB_DEFAULTS.password;
  url.searchParams.set('host', DB_DEFAULTS.host);
  const output = execFileSync('bash', ['-c', `fail() { echo "$1" >&2; exit 1; }\n${program}`], {
    cwd: brainDir, encoding: 'utf8', timeout: 20000, env: { ...process.env,
      NODE: process.execPath, BRAIN_DIR: brainDir, ROOT: root, DEC: decision, TAG: randomUUID(),
      DATABASE_URL: url.toString(), PGOPTIONS: `-c search_path=${schema}`,
    },
  });
  expect(output).toContain('RELAY_MIRROR_PROJECTION_PASS');
  const projected = (await client.query('SELECT status,custom_props,notion_props FROM projects WHERE id=$1', [root])).rows[0];
  expect(projected.status).toBe('completed');
  expect(projected.custom_props.remark).toBe('人工 smoke 备注');
  expect(projected.notion_props.project_digest).toBeTruthy();
  expect((await client.query('SELECT notion_props FROM projects WHERE id=$1', [unrelated])).rows[0].notion_props).toEqual({});
  expect((await client.query('SELECT notion_id FROM decisions WHERE id=$1', [decision])).rows[0].notion_id).toBeTruthy();
});
