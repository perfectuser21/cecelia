/**
 * Project State Machine Tests
 * Tests for state transitions: planning → active → reviewing → completed
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
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

async function createProject(name = 'State Machine Test') {
  const res = await fetch(`${API_BASE}/api/tasks/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  testProjectIds.push(data.id);
  return data;
}

describe('Project State Machine', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    for (const id of testProjectIds) {
      await pool.query('DELETE FROM projects WHERE id = $1', [id]).catch(() => {});
    }
    await pool.end();
  });

  afterEach(async () => {
    // Clean up projects created in each test
  });

  describe('Default Status', () => {
    it('new project defaults to planning status', async () => {
      const project = await createProject();
      expect(project.status).toBe('planning');
    });
  });

  describe('POST /:id/transition', () => {
    it('planning → active is valid', async () => {
      const project = await createProject();
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.project.status).toBe('active');
      expect(data.transition).toEqual({ from: 'planning', to: 'active' });
    });

    it('active → reviewing is valid', async () => {
      const project = await createProject();
      // planning → active
      await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      // active → reviewing
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reviewing' })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.project.status).toBe('reviewing');
    });

    it('reviewing → completed is valid', async () => {
      const project = await createProject();
      await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reviewing' })
      });
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.project.status).toBe('completed');
    });

    it('active → planning (rollback) is valid', async () => {
      const project = await createProject();
      await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'planning' })
      });
      expect(res.status).toBe(200);
      expect((await res.json()).project.status).toBe('planning');
    });

    it('reviewing → active (rollback) is valid', async () => {
      const project = await createProject();
      await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reviewing' })
      });
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      expect(res.status).toBe(200);
      expect((await res.json()).project.status).toBe('active');
    });

    it('planning → completed is invalid (skip)', async () => {
      const project = await createProject();
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      expect(res.status).toBe(400);
    });

    it('planning → reviewing is invalid (skip)', async () => {
      const project = await createProject();
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reviewing' })
      });
      expect(res.status).toBe(400);
    });

    it('completed → any is invalid', async () => {
      const project = await createProject();
      // Walk to completed
      for (const s of ['active', 'reviewing', 'completed']) {
        await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: s })
        });
      }
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      expect(res.status).toBe(400);
    });

    it('invalid status value returns 400', async () => {
      const project = await createProject();
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'nonexistent' })
      });
      expect(res.status).toBe(400);
    });

    it('non-existent project returns 404', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await fetch(`${API_BASE}/api/tasks/projects/${fakeId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH status validation', () => {
    it('rejects invalid status via PATCH', async () => {
      const project = await createProject();
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'invalid_status' })
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid transition via PATCH', async () => {
      const project = await createProject();
      // planning → completed is invalid
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      expect(res.status).toBe(400);
    });

    it('allows valid transition via PATCH', async () => {
      const project = await createProject();
      const res = await fetch(`${API_BASE}/api/tasks/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      });
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('active');
    });
  });
});
