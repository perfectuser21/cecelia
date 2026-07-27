/**
 * migration 365：tasks.executor_kind 放宽到六类，收 'kernel-process'。
 *
 * 329 建列时 CHECK 只列了五类，Kernel v1 的裸 Node 进程没有归属，
 * 派发点只能把它打成 relay-container，探活走 docker ps 恒 dead（事故 51836fb2）。
 *
 * 真库跑：在独立 schema 里重建 329 的原始约束，套上 365，验证新旧值都能落、非法值仍被拒。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const migration365 = readFileSync(
  new URL('../../../migrations/365_executor_kind_kernel_process.sql', import.meta.url),
  'utf8',
);

const schemaName = `executor_kind_365_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;

let adminPool;
let client;

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  client = await adminPool.connect();
  await client.query(`SET search_path TO ${quotedSchema}`);
  await client.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE tasks (
      id UUID PRIMARY KEY,
      executor_kind TEXT
        CONSTRAINT tasks_executor_kind_check
        CHECK (executor_kind IS NULL OR executor_kind IN (
          'brain-local','relay-container','headed-session','bridge','external-worker'
        ))
    );
  `);
}, 15_000);

afterAll(async () => {
  if (client) client.release();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
});

const insert = (kind) =>
  client.query('INSERT INTO tasks (id, executor_kind) VALUES ($1,$2)', [randomUUID(), kind]);

describe('migration 365 — executor_kind 放宽收 kernel-process', () => {
  it('迁移前 kernel-process 被 329 的 CHECK 拒绝（证明这条迁移不是空转）', async () => {
    await expect(insert('kernel-process')).rejects.toMatchObject({ code: '23514' });
  });

  it('迁移后 kernel-process 可落库，五个旧值与 NULL 全部照旧，非法值仍被拒', async () => {
    await client.query(migration365);

    await expect(insert('kernel-process')).resolves.toBeTruthy();
    for (const kind of ['brain-local', 'relay-container', 'headed-session', 'bridge', 'external-worker']) {
      await expect(insert(kind)).resolves.toBeTruthy();
    }
    await expect(insert(null)).resolves.toBeTruthy();
    await expect(insert('made-up-kind')).rejects.toMatchObject({ code: '23514' });

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM tasks WHERE executor_kind = 'kernel-process'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('重复应用不炸（DROP CONSTRAINT IF EXISTS 幂等）+ 登记 schema_version 365', async () => {
    await expect(client.query(migration365)).resolves.toBeTruthy();
    const { rows } = await client.query(
      `SELECT version FROM schema_version WHERE version = '365'`,
    );
    expect(rows).toHaveLength(1);
  });
});
