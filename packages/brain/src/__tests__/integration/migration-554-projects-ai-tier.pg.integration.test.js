import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';

// 本地仅使用 scratch；CI 使用独立 service 数据库。只建隔离 schema，不碰现有表。
const database = process.env.CI ? DB_DEFAULTS.database : 'cecelia_scratch';
const schema = `projects_ai_tier_${randomUUID().replaceAll('-', '')}`;
const client = new pg.Client({ ...DB_DEFAULTS, database });
const readMigration = (down = false) => readFileSync(new URL(
  `../../../migrations/${down ? 'rollback/' : ''}554_projects_ai_tier${down ? '.down' : ''}.sql`, import.meta.url
), 'utf8');

beforeAll(async () => {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
});
beforeEach(async () => {
  await client.query('ROLLBACK');
  await client.query('DROP TABLE IF EXISTS projects, schema_version');
  await client.query(`CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
    notion_props jsonb NOT NULL DEFAULT '{}');
    CREATE TABLE schema_version (version text PRIMARY KEY, description text);
    INSERT INTO projects (name, notion_props) VALUES ('已有项目', '{"notion_id":"page-1"}')`);
});
afterAll(async () => {
  await client.query('ROLLBACK');
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe.sequential('迁移 554 项目档位与 Notion 唯一关联', () => {
  it('已有与新建项目默认知情，合法档位持久化，非法值和 null 被 DB 拒绝', async () => {
    await client.query(readMigration());
    expect((await client.query('SELECT ai_tier FROM projects')).rows[0].ai_tier).toBe('知情');
    expect((await client.query("INSERT INTO projects(name) VALUES ('新项目') RETURNING ai_tier")).rows[0].ai_tier).toBe('知情');
    for (const tier of ['知情', '盯着', '介入']) {
      expect((await client.query('UPDATE projects SET ai_tier=$1 RETURNING ai_tier', [tier])).rows[0].ai_tier).toBe(tier);
    }
    await expect(client.query("UPDATE projects SET ai_tier='invalid'")).rejects.toMatchObject({ code: '23514' });
    await expect(client.query('UPDATE projects SET ai_tier=NULL')).rejects.toMatchObject({ code: '23502' });
  });
  it('同一 Notion 页不能关联两个项目，未关联项目可重复创建', async () => {
    await client.query(readMigration());
    await expect(client.query(`INSERT INTO projects(name, notion_props) VALUES ('重复', '{"notion_id":"page-1"}')`))
      .rejects.toMatchObject({ code: '23505' });
    await client.query("INSERT INTO projects(name) VALUES ('无关联1'), ('无关联2')");
    expect((await client.query('SELECT count(*)::int AS n FROM projects')).rows[0].n).toBe(3);
  });
  it('迁移幂等且保留用户已经设置的档位', async () => {
    await client.query(readMigration());
    await client.query("UPDATE projects SET ai_tier='介入'");
    await client.query(readMigration());
    expect((await client.query('SELECT ai_tier FROM projects')).rows[0].ai_tier).toBe('介入');
    expect((await client.query("SELECT count(*)::int AS n FROM schema_version WHERE version='554'")).rows[0].n).toBe(1);
  });
  it('历史重复关联使整次迁移失败，不删除或改写已有项目', async () => {
    await client.query(`INSERT INTO projects(name, notion_props) VALUES ('历史重复', '{"notion_id":"page-1"}')`);
    await expect(client.query(readMigration())).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK');
    expect((await client.query('SELECT count(*)::int AS n FROM projects')).rows[0].n).toBe(2);
    expect((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='projects' AND column_name='ai_tier'", [schema])).rows[0].n).toBe(0);
  });
  it('回滚移除新增结构并保留项目记录', async () => {
    await client.query(readMigration());
    await client.query(readMigration(true));
    expect((await client.query('SELECT count(*)::int AS n FROM projects')).rows[0].n).toBe(1);
    expect((await client.query("SELECT count(*)::int AS n FROM schema_version WHERE version='554'")).rows[0].n).toBe(0);
    await client.query(readMigration());
  });
});
