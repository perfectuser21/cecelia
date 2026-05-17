/**
 * Project List Filtering Tests
 * Tests for enhanced query parameters: status, area_id, parent_id, top_level
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia_tasks',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'n8n_password_2025'
});

const API_BASE = process.env.API_BASE || 'http://localhost:5211';

let testProjectIds = [];
let parentProjectId;
let childProjectId;
let areaId;

async function createProject(data) {
  const res = await fetch(`${API_BASE}/api/tasks/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const project = await res.json();
  testProjectIds.push(project.id);
  return project;
}

describe('Project List Filtering', () => {
  beforeAll(async () => {
    // Get an area_id from existing areas
    const areaResult = await pool.query('SELECT id FROM areas LIMIT 1');
    areaId = areaResult.rows[0]?.id;

    // Create parent project
    const parent = await createProject({ name: 'Filter Test Parent' });
    parentProjectId = parent.id;

    // Transition parent to active
    await fetch(`${API_BASE}/api/tasks/projects/${parentProjectId}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' })
    });

    // Set area_id directly via DB
    if (areaId) {
      await pool.query('UPDATE projects SET area_id = $1 WHERE id = $2', [areaId, parentProjectId]);
    }

    // Create child project (Feature)
    const child = await createProject({ name: 'Filter Test Child', parent_id: parentProjectId });
    childProjectId = child.id;
  });

  afterAll(async () => {
    for (const id of testProjectIds.reverse()) {
      await pool.query('DELETE FROM projects WHERE id = $1', [id]).catch(() => {});
    }
    await pool.end();
  });

  it('filters by status', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects?status=active`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    for (const p of data) {
      expect(p.status).toBe('active');
    }
  });

  it('returns empty array for non-matching status', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects?status=nonexistent_status_xyz`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual([]);
  });

  it('filters by area_id', async () => {
    if (!areaId) return; // skip if no areas
    const res = await fetch(`${API_BASE}/api/tasks/projects?area_id=${areaId}`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.length).toBeGreaterThan(0);
    for (const p of data) {
      expect(p.area_id).toBe(areaId);
    }
  });

  it('filters by top_level=true (parent_id IS NULL)', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects?top_level=true`);
    const data = await res.json();
    expect(res.status).toBe(200);
    for (const p of data) {
      expect(p.parent_id).toBeNull();
    }
  });

  it('filters by parent_id', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects?parent_id=${parentProjectId}`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.length).toBeGreaterThan(0);
    for (const p of data) {
      expect(p.parent_id).toBe(parentProjectId);
    }
  });

  it('parent_id takes priority over top_level', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects?top_level=true&parent_id=${parentProjectId}`);
    const data = await res.json();
    expect(res.status).toBe(200);
    for (const p of data) {
      expect(p.parent_id).toBe(parentProjectId);
    }
  });

  it('combines status and top_level filters', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects?status=active&top_level=true`);
    const data = await res.json();
    expect(res.status).toBe(200);
    for (const p of data) {
      expect(p.status).toBe('active');
      expect(p.parent_id).toBeNull();
    }
  });

  it('returns all projects without filters', async () => {
    const res = await fetch(`${API_BASE}/api/tasks/projects`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.length).toBeGreaterThanOrEqual(2); // at least parent + child
  });
});
