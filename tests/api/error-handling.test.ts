import { describe, it, expect } from 'vitest';

describe('Error Handling and Edge Cases', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';

  describe('404 Not Found Errors', () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    it('should return 404 for non-existent project', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${nonExistentId}`);
      expect(res.status).toBe(404);
      const error = await res.json();
      expect(error).toHaveProperty('error');
    });

    it('should return 404 for non-existent goal', async () => {
      const res = await fetch(`${API_BASE}/api/goals/${nonExistentId}`);
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent task', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${nonExistentId}`);
      expect(res.status).toBe(404);
    });

    it('should return 404 when deleting non-existent resource', async () => {
      const res = await fetch(`${API_BASE}/api/projects/${nonExistentId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('400 Bad Request Errors', () => {
    it('should return 400 for empty PATCH request', async () => {
      // First create a project
      const wsRes = await fetch(`${API_BASE}/api/workspaces`);
      const workspaces = await wsRes.json();
      const workspaceId = workspaces[0]?.id;

      const createRes = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: 'Test Project',
        }),
      });
      const project = await createRes.json();

      // Try to update with no fields
      const patchRes = await fetch(`${API_BASE}/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(patchRes.status).toBe(400);

      // Cleanup
      await fetch(`${API_BASE}/api/projects/${project.id}`, { method: 'DELETE' });
    });

    it('should return 400 for invalid link type', async () => {
      const wsRes = await fetch(`${API_BASE}/api/workspaces`);
      const workspaces = await wsRes.json();
      const workspaceId = workspaces[0]?.id;

      // Create project and tasks
      const projRes = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: 'Link Test Project',
        }),
      });
      const project = await projRes.json();

      const task1Res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          title: 'Task 1',
          priority: 'P0',
        }),
      });
      const task1 = await task1Res.json();

      const task2Res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          title: 'Task 2',
          priority: 'P0',
        }),
      });
      const task2 = await task2Res.json();

      // Try to create link with invalid type
      const linkRes = await fetch(`${API_BASE}/api/tasks/${task1.id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: task2.id,
          linkType: 'invalid_type',
        }),
      });

      expect(linkRes.status).toBe(400);

      // Cleanup
      await fetch(`${API_BASE}/api/tasks/${task1.id}`, { method: 'DELETE' });
      await fetch(`${API_BASE}/api/tasks/${task2.id}`, { method: 'DELETE' });
      await fetch(`${API_BASE}/api/projects/${project.id}`, { method: 'DELETE' });
    });

    it('should return 400 for self-referencing link', async () => {
      const wsRes = await fetch(`${API_BASE}/api/workspaces`);
      const workspaces = await wsRes.json();
      const workspaceId = workspaces[0]?.id;

      const projRes = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: 'Self Link Test',
        }),
      });
      const project = await projRes.json();

      const taskRes = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          title: 'Task',
          priority: 'P0',
        }),
      });
      const task = await taskRes.json();

      // Try to create self-link
      const linkRes = await fetch(`${API_BASE}/api/tasks/${task.id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: task.id,
          linkType: 'blocks',
        }),
      });

      expect(linkRes.status).toBe(400);

      // Cleanup
      await fetch(`${API_BASE}/api/tasks/${task.id}`, { method: 'DELETE' });
      await fetch(`${API_BASE}/api/projects/${project.id}`, { method: 'DELETE' });
    });
  });

  describe('500 Internal Server Errors', () => {
    it('should return 500 for missing required field', async () => {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Project without workspace',
          // Missing workspace_id
        }),
      });

      expect(res.status).toBe(500);
      const error = await res.json();
      expect(error).toHaveProperty('error');
    });

    it('should return 500 for invalid foreign key', async () => {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: '00000000-0000-0000-0000-000000000000',
          title: 'Task with invalid project',
          priority: 'P0',
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('Malformed Requests', () => {
    it('should handle malformed JSON', async () => {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json}',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle missing Content-Type header', async () => {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        // Missing Content-Type header
      });

      // Should still work or return appropriate error
      expect([200, 201, 400, 415, 500]).toContain(res.status);
    });
  });

  describe('Query Parameter Validation', () => {
    it('should handle invalid query parameters gracefully', async () => {
      const res = await fetch(`${API_BASE}/api/tasks?invalid_param=value`);
      expect(res.status).toBe(200);
      // Should ignore invalid params and return all tasks
      const tasks = await res.json();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should handle multiple values for same parameter', async () => {
      const res = await fetch(`${API_BASE}/api/tasks?status=queued&status=in_progress`);
      expect(res.status).toBe(200);
      // Should handle gracefully (use first value or return error)
      const tasks = await res.json();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long strings', async () => {
      const wsRes = await fetch(`${API_BASE}/api/workspaces`);
      const workspaces = await wsRes.json();
      const workspaceId = workspaces[0]?.id;

      const longString = 'A'.repeat(10000);

      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: longString,
          description: longString,
        }),
      });

      // Should either accept (201) or reject with validation error (400/500)
      expect([201, 400, 500]).toContain(res.status);

      if (res.status === 201) {
        const project = await res.json();
        await fetch(`${API_BASE}/api/projects/${project.id}`, { method: 'DELETE' });
      }
    });

    it('should handle special characters in strings', async () => {
      const wsRes = await fetch(`${API_BASE}/api/workspaces`);
      const workspaces = await wsRes.json();
      const workspaceId = workspaces[0]?.id;

      const specialChars = `Special chars: <>&"'`;

      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: specialChars,
        }),
      });

      expect(res.status).toBe(201);
      const project = await res.json();
      expect(project.name).toBe(specialChars);

      // Cleanup
      await fetch(`${API_BASE}/api/projects/${project.id}`, { method: 'DELETE' });
    });

    it('should handle empty strings', async () => {
      const wsRes = await fetch(`${API_BASE}/api/workspaces`);
      const workspaces = await wsRes.json();
      const workspaceId = workspaces[0]?.id;

      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: '',
        }),
      });

      // Should either accept empty string or reject
      expect([201, 400, 500]).toContain(res.status);
    });
  });
});
