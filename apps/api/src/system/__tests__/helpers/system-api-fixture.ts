import express from 'express';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { vi } from 'vitest';

export const taskIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
];
export const goalId = '10000000-0000-4000-8000-000000000001';

type FixtureResponse<Body> = Omit<Response, 'json'> & { json: () => Promise<Body> };

export async function createSystemApiFixture<Body = unknown>() {
  if (process.env.API_PG_INTEGRATION !== '1'
    || !['127.0.0.1', 'localhost'].includes(process.env.DB_HOST || '')
    || process.env.DB_NAME !== 'cecelia_scratch'
    || !process.env.DB_PORT || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error('API integration requires API_PG_INTEGRATION=1 and explicit local DB_HOST/DB_PORT/DB_USER/DB_PASSWORD with DB_NAME=cecelia_scratch');
  }
  const schema = `api_ci_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    max: 1, connectionTimeoutMillis: 2000,
  });
  const tempDirectory = await mkdtemp(join(tmpdir(), 'cecelia-api-pg-'));
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const previousEnv = { ...process.env };
  let server: Server | undefined;
  let pool: pg.Pool | undefined;
  let stopHealthChecks: (() => void) | undefined;
  let baseUrl = '';
  const unexpectedRequests: string[] = [];
  const executions: Array<{ task_id: string; prd_path: string; priority: string; source: string }> = [];

  async function close() {
    try {
      stopHealthChecks?.();
      if (server) await new Promise<void>((resolve, reject) => {
        server!.close(error => error ? reject(error) : resolve());
        server!.closeAllConnections();
      });
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
      vi.unstubAllGlobals();
      for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
      Object.assign(process.env, previousEnv);
      await rm(tempDirectory, { recursive: true, force: true });
    }
    if (unexpectedRequests.length) throw new Error(`Unexpected external requests: ${unexpectedRequests.join(', ')}`);
  }

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    process.env.PGOPTIONS = `-c search_path=${schema} -c statement_timeout=5000`;
    process.env.PRD_TEMP_DIR = tempDirectory;
    for (const [key, service] of Object.entries({
      BRAIN_API: 'brain', WORKSPACE_API: 'workspace', QUALITY_API: 'quality',
      N8N_BACKEND: 'n8n', CECELIA_EXECUTOR_URL: 'executor',
    })) process.env[key] = `http://${service}.fixture.invalid`;

    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      if (baseUrl && url.origin === new URL(baseUrl).origin) return nativeFetch(input, options);
      if (['http://brain.fixture.invalid/api/brain/tick/status', 'http://workspace.fixture.invalid/api/system/health',
        'http://quality.fixture.invalid/api/state', 'http://n8n.fixture.invalid/healthz'].includes(url.href)
        && (!options?.method || options.method === 'GET')) return Response.json({ success: true });
      if (url.href === 'http://executor.fixture.invalid/execute' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        if (!body.task_id || body.priority !== 'P0' || body.source !== 'system'
          || !body.prd_path?.startsWith(`${tempDirectory}/`)) throw new Error('Invalid executor request');
        executions.push(body);
        return Response.json({ success: true, data: { execution_id: `execution-${body.task_id}` } });
      }
      unexpectedRequests.push(url.href);
      throw new Error(`External fetch denied: ${url.href}`);
    });

    pool = (await import('../../../task-system/db.js')).default;
    const { rows } = await pool.query('SELECT current_database() AS db, current_schema() AS schema');
    if (rows[0].db !== 'cecelia_scratch' || rows[0].schema !== schema) throw new Error('API database/schema isolation failed');
    // Use the repository schema, not an invented permissive SQL fake.
    await pool.query(await readFile(new URL('../../../../../../packages/brain/migrations/000_base_schema.sql', import.meta.url), 'utf8'));
    const memory = await import('../../memory.js');
    await memory.initMemoryTable();
    const { default: router } = await import('../../routes.js');
    ({ stopHealthChecks } = await import('../../degrade.js'));
    stopHealthChecks();
    // Drain the import-time health cycle; its four fetches are fixture-only.
    await new Promise(resolve => setImmediate(resolve));
    const app = express();
    app.use(express.json());
    app.use('/api/system', router);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture HTTP address');
    baseUrl = `http://127.0.0.1:${address.port}/api/system`;

    return {
      pool, schema, executions, tempDirectory, close,
      async request(path: string, options?: RequestInit) { return fetch(`${baseUrl}${path}`, options) as Promise<FixtureResponse<Body>>; },
      async json(path: string, body: unknown = {}, method = 'POST') {
        return fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as Promise<FixtureResponse<Body>>;
      },
      async reset() {
        executions.length = 0;
        await pool!.query(`TRUNCATE "${schema}".memory_entries, "${schema}".tasks, "${schema}".goals CASCADE`);
      },
      async seedPlanning() {
        await pool!.query('INSERT INTO goals (id,title,priority,progress,status) VALUES ($1,$2,$3,$4,$5)', [goalId, '质量目标', 'P0', 25, 'active']);
        // Deliberately insert P1 before P0, plus a completed P0 that must be excluded.
        for (const [id, title, priority, status, created] of [
          [taskIds[2], '更新文档', 'P1', 'pending', '2026-01-01T00:00:00Z'],
          [taskIds[1], '测试回归', 'P0', 'in_progress', '2026-01-03T00:00:00Z'],
          [taskIds[3], '清理文件', 'P2', 'queued', '2026-01-04T00:00:00Z'],
          [taskIds[0], '实现入口', 'P0', 'queued', '2026-01-02T00:00:00Z'],
          [taskIds[4], '已完成入口', 'P0', 'completed', '2026-01-01T00:00:00Z'],
        ]) await pool!.query('INSERT INTO tasks (id,title,priority,status,goal_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, title, priority, status, id === taskIds[3] ? null : goalId, created]);
        await memory.writeMemory({ layer: 'working', category: 'context', key: 'current_focus', value: { focus: '测试' } });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type SystemApiFixture<Body = unknown> = Awaited<ReturnType<typeof createSystemApiFixture<Body>>>;
