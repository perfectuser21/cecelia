import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Task Links API (Bidirectional Links)', () => {
  const API_BASE = process.env.API_BASE || 'http://localhost:5220';
  let workspaceId: string;
  let projectId: string;
  let task1Id: string;
  let task2Id: string;
  let task3Id: string;
  let linkId: string;

  beforeAll(async () => {
    // Setup: create project and tasks
    const wsRes = await fetch(`${API_BASE}/api/workspaces`);
    const workspaces = await wsRes.json();
    workspaceId = workspaces[0]?.id;

    const projRes = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        name: 'Test Project for Links',
      }),
    });
    const project = await projRes.json();
    projectId = project.id;

    // Create 3 tasks for testing links
    const task1Res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 1 (Blocker)',
        priority: 'P0',
      }),
    });
    task1Id = (await task1Res.json()).id;

    const task2Res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 2 (Blocked)',
        priority: 'P1',
      }),
    });
    task2Id = (await task2Res.json()).id;

    const task3Res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 3 (Related)',
        priority: 'P1',
      }),
    });
    task3Id = (await task3Res.json()).id;
  });

  afterAll(async () => {
    // Cleanup
    if (task1Id) await fetch(`${API_BASE}/api/tasks/${task1Id}`, { method: 'DELETE' });
    if (task2Id) await fetch(`${API_BASE}/api/tasks/${task2Id}`, { method: 'DELETE' });
    if (task3Id) await fetch(`${API_BASE}/api/tasks/${task3Id}`, { method: 'DELETE' });
    if (projectId) await fetch(`${API_BASE}/api/projects/${projectId}`, { method: 'DELETE' });
  });

  describe('CREATE - POST /api/tasks/:id/links', () => {
    it('should create a "blocks" link', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task1Id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: task2Id,
          linkType: 'blocks',
        }),
      });

      expect(res.status).toBe(201);
      const link = await res.json();
      expect(link.source_task_id).toBe(task1Id);
      expect(link.target_task_id).toBe(task2Id);
      expect(link.link_type).toBe('blocks');
      linkId = link.id;
    });

    it('should create a "relates_to" link', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task2Id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: task3Id,
          linkType: 'relates_to',
        }),
      });

      expect(res.status).toBe(201);
      const link = await res.json();
      expect(link.link_type).toBe('relates_to');
    });

    it('should create a "depends_on" link', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task3Id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: task1Id,
          linkType: 'depends_on',
        }),
      });

      expect(res.status).toBe(201);
      const link = await res.json();
      expect(link.link_type).toBe('depends_on');
    });

    it('should reject invalid link type', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task1Id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: task2Id,
          linkType: 'invalid_type',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject self-link', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task1Id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: task1Id,
          linkType: 'blocks',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('READ - GET /api/tasks/:id/links', () => {
    it('should get all links for a task', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task1Id}/links`);
      expect(res.status).toBe(200);
      const links = await res.json();
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBeGreaterThan(0);
    });

    it('should include bidirectional links', async () => {
      // task1 blocks task2, so:
      // - task1/links should show outgoing "blocks"
      // - task2/backlinks should show incoming "blocked_by"

      const task1Links = await fetch(`${API_BASE}/api/tasks/${task1Id}/links`);
      const links1 = await task1Links.json();

      const blocksLink = links1.find((l: any) => l.target_task_id === task2Id);
      expect(blocksLink).toBeDefined();
      expect(blocksLink.link_type).toBe('blocks');
    });
  });

  describe('BACKLINKS - GET /api/tasks/:id/backlinks', () => {
    it('should get backlinks (inverse links)', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task2Id}/backlinks`);
      expect(res.status).toBe(200);
      const backlinks = await res.json();
      expect(Array.isArray(backlinks)).toBe(true);

      // task2 is blocked by task1
      const blockedBy = backlinks.find((l: any) => l.source_task_id === task1Id);
      expect(blockedBy).toBeDefined();
      expect(blockedBy.link_type).toBe('blocked_by');
    });

    it('should return empty array for task with no backlinks', async () => {
      // Create a new task with no links
      const newTaskRes = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          title: 'Isolated Task',
          priority: 'P2',
        }),
      });
      const newTask = await newTaskRes.json();

      const res = await fetch(`${API_BASE}/api/tasks/${newTask.id}/backlinks`);
      const backlinks = await res.json();
      expect(Array.isArray(backlinks)).toBe(true);
      expect(backlinks.length).toBe(0);

      // Cleanup
      await fetch(`${API_BASE}/api/tasks/${newTask.id}`, { method: 'DELETE' });
    });
  });

  describe('DELETE - DELETE /api/tasks/:id/links/:linkId', () => {
    it('should delete a link', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task1Id}/links/${linkId}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
    });

    it('should remove link from both tasks', async () => {
      // After deleting the link, both tasks should not show it
      const task1Links = await fetch(`${API_BASE}/api/tasks/${task1Id}/links`);
      const links1 = await task1Links.json();
      const deletedLink = links1.find((l: any) => l.id === linkId);
      expect(deletedLink).toBeUndefined();

      const task2Backlinks = await fetch(`${API_BASE}/api/tasks/${task2Id}/backlinks`);
      const backlinks2 = await task2Backlinks.json();
      const deletedBacklink = backlinks2.find((l: any) => l.id === linkId);
      expect(deletedBacklink).toBeUndefined();
    });

    it('should return 404 for non-existent link', async () => {
      const res = await fetch(`${API_BASE}/api/tasks/${task1Id}/links/00000000-0000-0000-0000-000000000000`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Bidirectional Link Consistency', () => {
    it('should maintain link type symmetry', async () => {
      // Create a "blocks" link from task1 to task2
      const createRes = await fetch(`${API_BASE}/api/tasks/${task1Id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTaskId: task2Id,
          linkType: 'blocks',
        }),
      });
      const link = await createRes.json();

      // Check task1's outgoing links
      const task1LinksRes = await fetch(`${API_BASE}/api/tasks/${task1Id}/links`);
      const task1Links = await task1LinksRes.json();
      const outgoingLink = task1Links.find((l: any) => l.id === link.id);
      expect(outgoingLink.link_type).toBe('blocks');

      // Check task2's incoming links (backlinks)
      const task2BacklinksRes = await fetch(`${API_BASE}/api/tasks/${task2Id}/backlinks`);
      const task2Backlinks = await task2BacklinksRes.json();
      const incomingLink = task2Backlinks.find((l: any) => l.id === link.id);
      expect(incomingLink.link_type).toBe('blocked_by');
    });
  });
});
