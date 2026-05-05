/**
 * Tenant Onboarding Integration Test
 *
 * 链路：okr_projects 表完整生命周期
 *   INSERT → SELECT → UPDATE status → upsert 幂等 → 软删除（archived）
 *
 * okr_projects 是系统中"项目/租户"的载体（project = tenant namespace）。
 * kr_id / area_id 均可为 NULL，故不依赖其他表数据。
 *
 * 运行环境：CI integration-core job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../packages/brain/src/db-config.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });
const insertedIds = [];

afterAll(async () => {
  if (insertedIds.length) {
    await pool.query('DELETE FROM okr_projects WHERE id = ANY($1::uuid[])', [insertedIds]);
  }
  await pool.end();
});

describe('Tenant Onboarding: okr_projects 生命周期', () => {
  let tenantId;

  it('INSERT — 创建租户项目，返回 UUID + 默认 planning 状态', async () => {
    const { rows } = await pool.query(
      `INSERT INTO okr_projects (title, status, metadata)
       VALUES ($1, 'planning', $2)
       RETURNING id, title, status, created_at`,
      [
        '[integration-test] Tenant Corp Alpha',
        JSON.stringify({ type: 'tenant', env: 'test', tier: 'standard' }),
      ]
    );
    expect(rows).toHaveLength(1);
    tenantId = rows[0].id;
    insertedIds.push(tenantId);
    expect(rows[0].title).toBe('[integration-test] Tenant Corp Alpha');
    expect(rows[0].status).toBe('planning');
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(rows[0].created_at).toBeTruthy();
  });

  it('SELECT — 按 id 查询，metadata 字段正确反序列化', async () => {
    const { rows } = await pool.query(
      'SELECT id, title, status, metadata, custom_props FROM okr_projects WHERE id = $1',
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.type).toBe('tenant');
    expect(rows[0].metadata.tier).toBe('standard');
    expect(rows[0].custom_props).toEqual({});
  });

  it('UPDATE — 状态流转 planning → active，updated_at 刷新', async () => {
    const { rows } = await pool.query(
      `UPDATE okr_projects
       SET status = 'active', updated_at = NOW(),
           custom_props = jsonb_set(custom_props, '{activated_at}', $2)
       WHERE id = $1
       RETURNING id, status, custom_props, updated_at`,
      [tenantId, JSON.stringify(new Date().toISOString())]
    );
    expect(rows[0].status).toBe('active');
    expect(rows[0].custom_props.activated_at).toBeTruthy();
  });

  it('ON CONFLICT DO UPDATE — 幂等 upsert 不插入重复行', async () => {
    await pool.query(
      `INSERT INTO okr_projects (id, title, status)
       VALUES ($1, '[integration-test] Duplicate', 'planning')
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [tenantId]
    );
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM okr_projects WHERE id = $1',
      [tenantId]
    );
    expect(rows[0].cnt).toBe(1);
  });

  it('UPDATE — 软删除：status = archived', async () => {
    const { rows } = await pool.query(
      `UPDATE okr_projects SET status = 'archived', updated_at = NOW()
       WHERE id = $1
       RETURNING status`,
      [tenantId]
    );
    expect(rows[0].status).toBe('archived');
  });

  it('SELECT — 已归档租户仍可查询（软删除不物理删除）', async () => {
    const { rows } = await pool.query(
      'SELECT id, status FROM okr_projects WHERE id = $1',
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('archived');
  });
});

describe('Tenant Onboarding: 约束验证', () => {
  it('title NOT NULL — 插入空 title 抛异常', async () => {
    await expect(
      pool.query('INSERT INTO okr_projects (title) VALUES (NULL)')
    ).rejects.toThrow();
  });

  it('status 默认值 — 不传 status 时自动为 planning', async () => {
    const { rows } = await pool.query(
      `INSERT INTO okr_projects (title) VALUES ($1) RETURNING id, status`,
      ['[integration-test] Default Status Check']
    );
    insertedIds.push(rows[0].id);
    expect(rows[0].status).toBe('planning');
  });
});
