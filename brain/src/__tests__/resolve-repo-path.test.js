/**
 * Tests for executor.resolveRepoPath - parent chain traversal
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;

const pool = new Pool(DB_DEFAULTS);

let testProjectIds = [];

describe('resolveRepoPath', () => {
  beforeAll(async () => {
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (testProjectIds.length > 0) {
      // Delete in reverse order (children first) to avoid FK issues
      for (const id of testProjectIds.reverse()) {
        await pool.query('DELETE FROM projects WHERE id = $1', [id]).catch(() => {});
      }
      testProjectIds = [];
    }
  });

  it('resolves repo_path from parent project when Feature has none', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    // Create parent Project with repo_path
    const parentResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('parent-proj', '/home/xx/test-repo', 'active') RETURNING id"
    );
    testProjectIds.push(parentResult.rows[0].id);

    // Create Feature (sub-project) without repo_path
    const featureResult = await pool.query(
      "INSERT INTO projects (name, parent_id, status) VALUES ('feature-1', $1, 'active') RETURNING id",
      [parentResult.rows[0].id]
    );
    testProjectIds.push(featureResult.rows[0].id);

    const repoPath = await resolveRepoPath(featureResult.rows[0].id);
    expect(repoPath).toBe('/home/xx/test-repo');
  });

  it('returns repo_path directly when project has it', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('direct-proj', '/home/xx/direct', 'active') RETURNING id"
    );
    testProjectIds.push(projResult.rows[0].id);

    const repoPath = await resolveRepoPath(projResult.rows[0].id);
    expect(repoPath).toBe('/home/xx/direct');
  });

  it('returns null for orphan project without repo_path', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    const projResult = await pool.query(
      "INSERT INTO projects (name, status) VALUES ('orphan-proj', 'active') RETURNING id"
    );
    testProjectIds.push(projResult.rows[0].id);

    const repoPath = await resolveRepoPath(projResult.rows[0].id);
    expect(repoPath).toBeNull();
  });

  it('returns null for non-existent project', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    const repoPath = await resolveRepoPath('00000000-0000-0000-0000-000000000000');
    expect(repoPath).toBeNull();
  });

  it('traverses multiple levels to find repo_path', async () => {
    const { resolveRepoPath } = await import('../executor.js');

    // Create 3-level chain: grandparent (with repo_path) → parent → child
    const grandparentResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('grandparent', '/home/xx/gp-repo', 'active') RETURNING id"
    );
    testProjectIds.push(grandparentResult.rows[0].id);

    const parentResult = await pool.query(
      "INSERT INTO projects (name, parent_id, status) VALUES ('parent-no-repo', $1, 'active') RETURNING id",
      [grandparentResult.rows[0].id]
    );
    testProjectIds.push(parentResult.rows[0].id);

    const childResult = await pool.query(
      "INSERT INTO projects (name, parent_id, status) VALUES ('child-no-repo', $1, 'active') RETURNING id",
      [parentResult.rows[0].id]
    );
    testProjectIds.push(childResult.rows[0].id);

    const repoPath = await resolveRepoPath(childResult.rows[0].id);
    expect(repoPath).toBe('/home/xx/gp-repo');
  });
});
