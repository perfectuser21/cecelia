/**
 * Tenant Onboarding Integration Test
 *
 * 棒4（决策 ee4842a6/3feeae3e，接力棒链 2afa6d69）：okr_projects 层随 migration 499
 * 写保护冻结，"项目/租户载体"的角色转移到真身表 projects（棒1，migration 497）。
 * 本测试原本整套跑在 okr_projects 上，migration 499 上线后 INSERT/UPDATE 会被
 * layer_retired 拒绝——改跑同一套生命周期断言，目标表换成 projects。
 *
 * 链路：projects 表完整生命周期
 *   INSERT → SELECT → UPDATE status → upsert 幂等 → 软删除（archived）
 *
 * projects 是系统中"项目/租户"的载体（project = tenant namespace）。
 * kr_id / area_id 均可为 NULL，故不依赖其他表数据。
 *
 * 运行环境：brain-integration CI job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });
const insertedIds = [];

afterAll(async () => {
  if (insertedIds.length) {
    await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [insertedIds]);
  }
  await pool.end();
});

describe('Tenant Onboarding: projects 生命周期', () => {
  let tenantId;

  it('INSERT — 创建租户项目，返回 UUID + 显式 planning 状态', async () => {
    const { rows } = await pool.query(
      `INSERT INTO projects (name, status, metadata)
       VALUES ($1, 'planning', $2)
       RETURNING id, name, status, created_at`,
      [
        '[integration-test] Tenant Corp Alpha',
        JSON.stringify({ type: 'tenant', env: 'test', tier: 'standard' }),
      ]
    );
    expect(rows).toHaveLength(1);
    tenantId = rows[0].id;
    insertedIds.push(tenantId);
    expect(rows[0].name).toBe('[integration-test] Tenant Corp Alpha');
    expect(rows[0].status).toBe('planning');
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(rows[0].created_at).toBeTruthy();
  });

  it('SELECT — 按 id 查询，metadata 字段正确反序列化', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, status, metadata, custom_props FROM projects WHERE id = $1',
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.type).toBe('tenant');
    expect(rows[0].metadata.tier).toBe('standard');
    expect(rows[0].custom_props).toEqual({});
  });

  it('UPDATE — 状态流转 planning → active，updated_at 刷新', async () => {
    const { rows } = await pool.query(
      `UPDATE projects
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
      `INSERT INTO projects (id, name, status)
       VALUES ($1, '[integration-test] Duplicate', 'planning')
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [tenantId]
    );
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM projects WHERE id = $1',
      [tenantId]
    );
    expect(rows[0].cnt).toBe(1);
  });

  it('UPDATE — 软删除：status = archived', async () => {
    const { rows } = await pool.query(
      `UPDATE projects SET status = 'archived', updated_at = NOW()
       WHERE id = $1
       RETURNING status`,
      [tenantId]
    );
    expect(rows[0].status).toBe('archived');
  });

  it('SELECT — 已归档租户仍可查询（软删除不物理删除）', async () => {
    const { rows } = await pool.query(
      'SELECT id, status FROM projects WHERE id = $1',
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('archived');
  });
});

describe('Tenant Onboarding: 约束验证', () => {
  it('name NOT NULL — 插入空 name 抛异常', async () => {
    await expect(
      pool.query('INSERT INTO projects (name) VALUES (NULL)')
    ).rejects.toThrow();
  });

  it('status 默认值 — 不传 status 时自动为 active（projects 表默认值，迁移 497）', async () => {
    const { rows } = await pool.query(
      `INSERT INTO projects (name) VALUES ($1) RETURNING id, status`,
      ['[integration-test] Default Status Check']
    );
    insertedIds.push(rows[0].id);
    expect(rows[0].status).toBe('active');
  });
});

describe('Tenant Onboarding: okr_projects 层写保护（migration 499，proven-to-fire）', () => {
  it('okr_projects 不再是写入目标 —— INSERT 抛 layer_retired', async () => {
    await expect(
      pool.query(`INSERT INTO okr_projects (title, status) VALUES ('[integration-test] should reject', 'planning')`)
    ).rejects.toThrow(/layer_retired/);
  });
});
