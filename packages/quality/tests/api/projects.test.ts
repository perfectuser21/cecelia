import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Projects CRUD API', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';
  let workspaceId: string;
  let testProjectId: string;

  beforeAll(async () => {
    // Get workspace
    const wsRes = await fetch(`${API_BASE}/api/workspaces`);
    const workspaces = await wsRes.json();
    workspaceId = workspaces[0]?.id;
  });

  afterAll(async () => {
    // Cleanup: delete test project if exists
    if (testProjectId) {
      await fetch(`${API_BASE}/api/projects/${testProjectId}`, {
        method: 'DELETE',
      });
    }
  });

  describe('CREATE - POST /api/projects', () => {
    it('should create a project with all fields', async () => {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: 'Test Project Full',
          description: 'Full test project',
          repo_path: '/test/repo',
          icon: '🚀',
          color: '#ff6b6b',
          status: 'active',
          metadata: { key: 'value' },
        }),
      });

      expect(res.status).toBe(201);
      const project = await res.json();
      expect(project.name).toBe('Test Project Full');
      expect(project.icon).toBe('🚀');
      expect(project.color).toBe('#ff6b6b');
      expect(project.metadata).toEqual({ key: 'value' });
      testProjectId = project.id;
    });

    it('should create project with minimal fields', async () => {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: 'Minimal Project',
        }),
      });

      expect(res.status).toBe(201);
      const project = await res.json();
      expect(project.name).toBe('Minimal Project');
      expect(project.icon).toBe('📦'); // default
      expect(project.color).toBe('#3b82f6'); // default
      expect(project.status).toBe('active'); // default
    });

    it('should reject missing required field (workspace_id)', async () => {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'No Workspace Project',
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('READ - GET /api/projects', () => {
    it('should list all projects', async () => {
      const res = await fetch(`${API_BASE}/api/projects`);
      expect(res.status).toBe(200);
      const projects = await res.json();
      expect(Array.isArray(projects)).toBe(true);
      expect(projects.length).toBeGreaterThan(0);
    });

    it('should filter projects by workspace_id', async () => {
      const res = await fetch(`${API_BASE}/api/projects?workspace_id=${workspaceId}`);
      expect(res.status).toBe(200);
      const projects = await res.json();
      expect(Array.isArray(projects)).toBe(true);
      projects.forEach((p: any) => {
        expect(p.workspace_id).toBe(workspaceId);
      });
    });

    it('should get project by id', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${testProjectId}`);
      expect(res.status).toBe(200);
      const project = await res.json();
      expect(project.id).toBe(testProjectId);
    });

    it('should return 404 for non-existent project', async () => {
      const res = await fetch(`${API_BASE}/api/projects/00000000-0000-0000-0000-000000000000`);
      expect(res.status).toBe(404);
    });
  });

  describe('UPDATE - PATCH /api/projects/:id', () => {
    it('should update project name', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${testProjectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Project Name',
        }),
      });

      expect(res.status).toBe(200);
      const project = await res.json();
      expect(project.name).toBe('Updated Project Name');
    });

    it('should update multiple fields', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${testProjectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Updated description',
          icon: '✨',
          status: 'archived',
        }),
      });

      expect(res.status).toBe(200);
      const project = await res.json();
      expect(project.description).toBe('Updated description');
      expect(project.icon).toBe('✨');
      expect(project.status).toBe('archived');
    });

    it('should reject empty update', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${testProjectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE - DELETE /api/projects/:id', () => {
    it('should delete project', async () => {
      // Create a project to delete
      const createRes = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: 'Project to Delete',
        }),
      });
      const project = await createRes.json();

      // Delete it
      const deleteRes = await fetch(`${API_BASE}/api/projects/${project.id}`, {
        method: 'DELETE',
      });

      expect(deleteRes.status).toBe(200);

      // Verify it's gone
      const getRes = await fetch(`${API_BASE}/api/projects/${project.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('STATS - GET /api/projects/:id/stats', () => {
    it('should return project statistics', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${testProjectId}/stats`);
      expect(res.status).toBe(200);
      const stats = await res.json();

      expect(stats).toHaveProperty('total_tasks');
      expect(stats).toHaveProperty('total_goals');
      expect(stats).toHaveProperty('tasks_by_status');
      expect(stats).toHaveProperty('tasks_by_priority');

      expect(typeof stats.total_tasks).toBe('number');
      expect(typeof stats.total_goals).toBe('number');
    });

    it('should return zero stats for empty project', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${testProjectId}/stats`);
      const stats = await res.json();

      // Stats should be numbers (even if zero)
      expect(stats.total_tasks).toBeGreaterThanOrEqual(0);
      expect(stats.total_goals).toBeGreaterThanOrEqual(0);
    });
  });
});
