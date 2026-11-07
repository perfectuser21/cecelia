import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { getProjectsForKrBatch } from '../../project-progress.js';

const client = new pg.Client(DB_DEFAULTS);
beforeAll(async () => {
  await client.connect();
  await client.query('CREATE TEMP TABLE projects (id text, name text, status text, kr_id text, created_at timestamptz)');
  await client.query('CREATE TEMP TABLE tasks (project_id text, task_type text, status text)');
  await client.query("INSERT INTO projects VALUES ('p', '测试项目', 'active', 'kr', now())");
  await client.query("INSERT INTO tasks VALUES ('p', 'dev', 'completed_no_pr'), ('p', 'data', 'completed_no_pr'), ('p', 'dev', 'completed')");
});
afterAll(async () => { await client.end(); });

it('项目完成数排除 dev 无 PR，保留非 dev 无 PR 与 dev 已完成', async () => {
  const projects = await getProjectsForKrBatch(client, ['kr']);
  expect(projects.kr[0]).toMatchObject({ task_total: 3, task_done: 2, progress: 66.67 });
});
