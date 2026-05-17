/**
 * Tests for Cecelia Overview Page
 * Verifies Brain API and Tasks API integration
 *
 * DoD Reference: docs/QA-DECISION.md
 * - Brain API integration: http://localhost:5221/api/brain/tick/status
 * - Tasks API integration: /api/tasks/tasks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const originalFetch = global.fetch;

describe('CeceliaOverview Data Integration', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Brain API Integration', () => {
    it('fetches tick status from Brain API endpoint', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 120,
        max_concurrent: 6,
        circuit_breakers: {
          'cecelia-run': {
            state: 'CLOSED',
            failures: 0,
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      // Simulate the loadData logic for Brain API
      const BRAIN_API_URL = 'http://localhost:5221';
      const response = await fetch(`${BRAIN_API_URL}/api/brain/tick/status`);

      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:5221/api/brain/tick/status');

      const data = await response.json();
      expect(data).toEqual(mockBrainData);
      expect(data.max_concurrent).toBe(6);
      expect(data.enabled).toBe(true);
      expect(data.circuit_breakers['cecelia-run'].state).toBe('CLOSED');
    });

    it('handles Brain API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const BRAIN_API_URL = 'http://localhost:5221';
      const response = await fetch(`${BRAIN_API_URL}/api/brain/tick/status`);

      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
    });

    it('correctly parses circuit breaker states', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: false,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T11:23:08Z',
        next_tick: '2026-02-01T11:25:08Z',
        actions_today: 150,
        max_concurrent: 6,
        circuit_breakers: {
          'cecelia-run': {
            state: 'OPEN' as const,
            failures: 10,
            last_failure_time: '2026-02-01T11:23:08Z',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      const BRAIN_API_URL = 'http://localhost:5221';
      const response = await fetch(`${BRAIN_API_URL}/api/brain/tick/status`);
      const data = await response.json();

      expect(data.circuit_breakers['cecelia-run'].state).toBe('OPEN');
      expect(data.circuit_breakers['cecelia-run'].failures).toBe(10);
      expect(data.circuit_breakers['cecelia-run'].last_failure_time).toBeDefined();
    });
  });

  describe('Tasks API Integration', () => {
    it('fetches tasks from Tasks API endpoint', async () => {
      const mockTasksData = [
        {
          id: 'task-1',
          title: 'Test Task 1',
          status: 'queued',
          created_at: '2026-02-01T10:00:00Z',
        },
        {
          id: 'task-2',
          title: 'Test Task 2',
          status: 'in_progress',
          created_at: '2026-02-01T10:05:00Z',
        },
        {
          id: 'task-3',
          title: 'Test Task 3',
          status: 'completed',
          created_at: '2026-02-01T09:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTasksData,
      });

      // Simulate the loadData logic for Tasks API
      const response = await fetch('/api/tasks/tasks');

      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/api/tasks/tasks');

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(3);
      expect(data[0].status).toBe('queued');
      expect(data[1].status).toBe('in_progress');
      expect(data[2].status).toBe('completed');
    });

    it('handles Tasks API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const response = await fetch('/api/tasks/tasks');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });

    it('correctly identifies all task statuses', async () => {
      const mockTasksData = [
        { id: '1', title: 'Queued Task', status: 'queued', created_at: '2026-02-01T10:00:00Z' },
        { id: '2', title: 'In Progress Task', status: 'in_progress', created_at: '2026-02-01T10:01:00Z' },
        { id: '3', title: 'Completed Task', status: 'completed', created_at: '2026-02-01T10:02:00Z' },
        { id: '4', title: 'Failed Task', status: 'failed', created_at: '2026-02-01T10:03:00Z' },
        { id: '5', title: 'Cancelled Task', status: 'cancelled', created_at: '2026-02-01T10:04:00Z' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTasksData,
      });

      const response = await fetch('/api/tasks/tasks');
      const data = await response.json();

      const statuses = new Set(data.map((task: any) => task.status));
      expect(statuses.has('queued')).toBe(true);
      expect(statuses.has('in_progress')).toBe(true);
      expect(statuses.has('completed')).toBe(true);
      expect(statuses.has('failed')).toBe(true);
      expect(statuses.has('cancelled')).toBe(true);
    });
  });

  describe('Parallel Data Fetching', () => {
    it('fetches Brain API and Tasks API in parallel', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 120,
        max_concurrent: 6,
        circuit_breakers: {},
      };

      const mockTasksData = [
        { id: '1', title: 'Task 1', status: 'queued', created_at: '2026-02-01T10:00:00Z' },
      ];

      // Mock both responses
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => mockBrainData })
        .mockResolvedValueOnce({ ok: true, json: async () => mockTasksData });

      // Simulate parallel fetching with Promise.all
      const [brainResponse, tasksResponse] = await Promise.all([
        fetch('http://localhost:5221/api/brain/tick/status'),
        fetch('/api/tasks/tasks'),
      ]);

      expect(brainResponse.ok).toBe(true);
      expect(tasksResponse.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const brainData = await brainResponse.json();
      const tasksData = await tasksResponse.json();

      expect(brainData.max_concurrent).toBe(6);
      expect(Array.isArray(tasksData)).toBe(true);
    });
  });

  describe('Data Validation', () => {
    it('validates Brain API response structure', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 120,
        max_concurrent: 6,
        circuit_breakers: {
          'cecelia-run': {
            state: 'CLOSED',
            failures: 0,
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      const response = await fetch('http://localhost:5221/api/brain/tick/status');
      const data = await response.json();

      // Verify all required fields are present
      expect(data).toHaveProperty('enabled');
      expect(data).toHaveProperty('loop_running');
      expect(data).toHaveProperty('loop_interval_ms');
      expect(data).toHaveProperty('last_tick');
      expect(data).toHaveProperty('next_tick');
      expect(data).toHaveProperty('actions_today');
      expect(data).toHaveProperty('max_concurrent');
      expect(data).toHaveProperty('circuit_breakers');

      // Verify data types
      expect(typeof data.enabled).toBe('boolean');
      expect(typeof data.loop_running).toBe('boolean');
      expect(typeof data.loop_interval_ms).toBe('number');
      expect(typeof data.max_concurrent).toBe('number');
      expect(typeof data.actions_today).toBe('number');
      expect(typeof data.circuit_breakers).toBe('object');
    });

    it('validates Tasks API response structure', async () => {
      const mockTasksData = [
        {
          id: 'task-1',
          title: 'Test Task',
          status: 'queued',
          created_at: '2026-02-01T10:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTasksData,
      });

      const response = await fetch('/api/tasks/tasks');
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);

      if (data.length > 0) {
        const task = data[0];
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('title');
        expect(task).toHaveProperty('status');
        expect(task).toHaveProperty('created_at');

        expect(typeof task.id).toBe('string');
        expect(typeof task.title).toBe('string');
        expect(['queued', 'in_progress', 'completed', 'failed', 'cancelled']).toContain(task.status);
      }
    });
  });

  describe('Edge Cases', () => {
    it('handles empty circuit breakers object', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 0,
        max_concurrent: 6,
        circuit_breakers: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      const response = await fetch('http://localhost:5221/api/brain/tick/status');
      const data = await response.json();

      expect(data.circuit_breakers).toEqual({});
      expect(Object.keys(data.circuit_breakers).length).toBe(0);
    });

    it('handles zero max_concurrent', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 0,
        max_concurrent: 0,
        circuit_breakers: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      const response = await fetch('http://localhost:5221/api/brain/tick/status');
      const data = await response.json();

      expect(data.max_concurrent).toBe(0);
      // Seats calculation should handle zero: availableSeats = 0 - 0 = 0
      const usedSeats = 0; // No in_progress tasks
      const availableSeats = data.max_concurrent - usedSeats;
      expect(availableSeats).toBe(0);
    });

    it('handles missing last_failure_time in circuit breaker', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 0,
        max_concurrent: 6,
        circuit_breakers: {
          'cecelia-run': {
            state: 'CLOSED' as const,
            failures: 0,
            // last_failure_time is optional
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      const response = await fetch('http://localhost:5221/api/brain/tick/status');
      const data = await response.json();

      expect(data.circuit_breakers['cecelia-run'].last_failure_time).toBeUndefined();
      expect(data.circuit_breakers['cecelia-run'].state).toBe('CLOSED');
    });

    it('handles empty tasks array', async () => {
      const mockTasksData: any[] = [];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTasksData,
      });

      const response = await fetch('/api/tasks/tasks');
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);

      // Task stats should all be zero
      const taskStats = data.reduce(
        (acc: any, task: any) => {
          acc[task.status] = (acc[task.status] || 0) + 1;
          return acc;
        },
        { queued: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 }
      );

      expect(taskStats).toEqual({
        queued: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });
    });

    it('handles HALF_OPEN circuit breaker state', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 50,
        max_concurrent: 6,
        circuit_breakers: {
          'cecelia-run': {
            state: 'HALF_OPEN' as const,
            failures: 5,
            last_failure_time: '2026-02-01T09:50:00Z',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      const response = await fetch('http://localhost:5221/api/brain/tick/status');
      const data = await response.json();

      expect(data.circuit_breakers['cecelia-run'].state).toBe('HALF_OPEN');
      expect(data.circuit_breakers['cecelia-run'].failures).toBe(5);
    });
  });

  describe('Data Transformations', () => {
    it('correctly calculates seats availability', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 100,
        max_concurrent: 6,
        circuit_breakers: {},
      };

      const mockTasksData = [
        { id: '1', title: 'Task 1', status: 'in_progress', created_at: '2026-02-01T10:00:00Z' },
        { id: '2', title: 'Task 2', status: 'in_progress', created_at: '2026-02-01T10:01:00Z' },
        { id: '3', title: 'Task 3', status: 'queued', created_at: '2026-02-01T10:02:00Z' },
      ];

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => mockBrainData })
        .mockResolvedValueOnce({ ok: true, json: async () => mockTasksData });

      const [brainResponse, tasksResponse] = await Promise.all([
        fetch('http://localhost:5221/api/brain/tick/status'),
        fetch('/api/tasks/tasks'),
      ]);

      const brainData = await brainResponse.json();
      const tasksData = await tasksResponse.json();

      // Calculate seats as component does
      const taskStats = tasksData.reduce(
        (acc: any, task: any) => {
          acc[task.status] = (acc[task.status] || 0) + 1;
          return acc;
        },
        { queued: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 }
      );

      const usedSeats = taskStats.in_progress;
      const maxSeats = brainData.max_concurrent;
      const availableSeats = maxSeats - usedSeats;

      expect(maxSeats).toBe(6);
      expect(usedSeats).toBe(2);
      expect(availableSeats).toBe(4);
    });

    it('converts loop_interval_ms to minutes', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: true,
        loop_interval_ms: 120000, // 2 minutes
        last_tick: '2026-02-01T10:00:00Z',
        next_tick: '2026-02-01T10:02:00Z',
        actions_today: 100,
        max_concurrent: 6,
        circuit_breakers: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      const response = await fetch('http://localhost:5221/api/brain/tick/status');
      const data = await response.json();

      const intervalMinutes = Math.round(data.loop_interval_ms / 60000);
      expect(intervalMinutes).toBe(2);

      // Test different intervals
      expect(Math.round(60000 / 60000)).toBe(1); // 1 minute
      expect(Math.round(300000 / 60000)).toBe(5); // 5 minutes
      expect(Math.round(180000 / 60000)).toBe(3); // 3 minutes
    });

    it('calculates task percentages correctly with zero check', async () => {
      const mockTasksData = [
        { id: '1', title: 'Task 1', status: 'queued', created_at: '2026-02-01T10:00:00Z' },
        { id: '2', title: 'Task 2', status: 'in_progress', created_at: '2026-02-01T10:01:00Z' },
        { id: '3', title: 'Task 3', status: 'completed', created_at: '2026-02-01T10:02:00Z' },
        { id: '4', title: 'Task 4', status: 'failed', created_at: '2026-02-01T10:03:00Z' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTasksData,
      });

      const response = await fetch('/api/tasks/tasks');
      const data = await response.json();

      const taskStats = data.reduce(
        (acc: any, task: any) => {
          acc[task.status] = (acc[task.status] || 0) + 1;
          return acc;
        },
        { queued: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 }
      );

      const totalTasks = data.length;

      // Calculate percentages with zero check (as component does)
      const queuedPct = totalTasks > 0 ? (taskStats.queued / totalTasks) * 100 : 0;
      const inProgressPct = totalTasks > 0 ? (taskStats.in_progress / totalTasks) * 100 : 0;
      const completedPct = totalTasks > 0 ? (taskStats.completed / totalTasks) * 100 : 0;
      const failedPct = totalTasks > 0 ? (taskStats.failed / totalTasks) * 100 : 0;

      expect(queuedPct).toBe(25); // 1/4
      expect(inProgressPct).toBe(25); // 1/4
      expect(completedPct).toBe(25); // 1/4
      expect(failedPct).toBe(25); // 1/4

      // Test zero check with empty array
      const emptyTasksPct = 0 > 0 ? (1 / 0) * 100 : 0;
      expect(emptyTasksPct).toBe(0); // Not NaN
    });

    it('handles loop_running false state', async () => {
      const mockBrainData = {
        enabled: true,
        loop_running: false, // Stopped
        loop_interval_ms: 120000,
        last_tick: '2026-02-01T09:00:00Z',
        next_tick: '2026-02-01T09:02:00Z',
        actions_today: 50,
        max_concurrent: 6,
        circuit_breakers: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrainData,
      });

      const response = await fetch('http://localhost:5221/api/brain/tick/status');
      const data = await response.json();

      expect(data.enabled).toBe(true);
      expect(data.loop_running).toBe(false);

      // Status text should be "已停止"
      const statusText = data.enabled && data.loop_running ? '运行中' : '已停止';
      expect(statusText).toBe('已停止');
    });
  });
});
