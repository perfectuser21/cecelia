/**
 * Tests for executor.resolveRepoPath - OKR tables traversal
 * 迁移：projects.repo_path to okr_* metadata repo_path
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;

const pool = new Pool(DB_DEFAULTS);

let testIds = { initiatives: [], scopes: [], projects: [] };

describe('resolveRepoPath', () => {
  beforeAll(async () => {
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    for (const id of testIds.initiatives) {
      await pool.query('DELETE FROM okr_initiatives WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of testIds.scopes) {
      await pool.query('DELETE FROM okr_scopes WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of testIds.projects) {
      await pool.query('DELETE FROM okr_projects WHERE id = $1', [id]).catch(() => {});
    }
    testIds = { initiatives: [], scopes: [], projects: [] };
  });

  it('resolves repo_path from okr_projects metadata', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    const meta = JSON.stringify({ repo_path: '/home/xx/test-repo' });
    const result = await pool.query(
      'INSERT INTO okr_projects (title, metadata, status) VALUES ($1, $2::jsonb, $3) RETURNING id',
      ['test-proj', meta, 'active']
    );
    testIds.projects.push(result.rows[0].id);

    const repoPath = await resolveRepoPath(result.rows[0].id);
    expect(repoPath).toBe('/home/xx/test-repo');
  });

  it('resolves repo_path from okr_initiatives metadata', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    const meta = JSON.stringify({ repo_path: '/home/xx/init-repo' });
    const result = await pool.query(
      'INSERT INTO okr_initiatives (title, metadata, status) VALUES ($1, $2::jsonb, $3) RETURNING id',
      ['test-init', meta, 'active']
    );
    testIds.initiatives.push(result.rows[0].id);

    const repoPath = await resolveRepoPath(result.rows[0].id);
    expect(repoPath).toBe('/home/xx/init-repo');
  });

  it('returns null for project without repo_path in metadata', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    const meta = JSON.stringify({});
    const result = await pool.query(
      'INSERT INTO okr_projects (title, metadata, status) VALUES ($1, $2::jsonb, $3) RETURNING id',
      ['no-repo-proj', meta, 'active']
    );
    testIds.projects.push(result.rows[0].id);

    const repoPath = await resolveRepoPath(result.rows[0].id);
    expect(repoPath).toBeNull();
  });

  it('returns null for non-existent project', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    const repoPath = await resolveRepoPath('00000000-0000-0000-0000-000000000000');
    expect(repoPath).toBeNull();
  });

  it('resolves repo_path from okr_scopes metadata', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    const meta = JSON.stringify({ repo_path: '/home/xx/scope-repo' });
    const result = await pool.query(
      'INSERT INTO okr_scopes (title, metadata, status) VALUES ($1, $2::jsonb, $3) RETURNING id',
      ['test-scope', meta, 'active']
    );
    testIds.scopes.push(result.rows[0].id);

    const repoPath = await resolveRepoPath(result.rows[0].id);
    expect(repoPath).toBe('/home/xx/scope-repo');
  });
});
