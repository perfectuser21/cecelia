/**
 * WebSocket Event Publisher Tests
 *
 * Tests the task event publishers that broadcast status changes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { broadcast, WS_EVENTS } from '../websocket.js';
import {
  publishTaskCreated,
  publishTaskStarted,
  publishTaskProgress,
  publishTaskCompleted,
  publishTaskFailed,
  publishExecutorStatus
} from '../events/taskEvents.js';

// Mock the broadcast function
vi.mock('../websocket.js', () => ({
  broadcast: vi.fn(),
  WS_EVENTS: {
    TASK_CREATED: 'task:created',
    TASK_STARTED: 'task:started',
    TASK_PROGRESS: 'task:progress',
    TASK_COMPLETED: 'task:completed',
    TASK_FAILED: 'task:failed',
    EXECUTOR_STATUS: 'executor:status'
  }
}));

describe('Task Event Publishers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('publishTaskCreated', () => {
    it('should broadcast task:created event with correct data', () => {
      const task = {
        id: 'task-123',
        run_id: 'run-456',
        title: 'Test Task',
        skill: '/dev',
        priority: 'P1'
      };

      publishTaskCreated(task);

      expect(broadcast).toHaveBeenCalledWith(WS_EVENTS.TASK_CREATED, {
        taskId: 'task-123',
        runId: 'run-456',
        status: 'queued',
        title: 'Test Task',
        skill: '/dev',
        priority: 'P1'
      });
    });
  });

  describe('publishTaskStarted', () => {
    it('should broadcast task:started event with correct data', () => {
      const task = {
        id: 'task-123',
        run_id: 'run-456'
      };

      publishTaskStarted(task);

      expect(broadcast).toHaveBeenCalledWith(
        WS_EVENTS.TASK_STARTED,
        expect.objectContaining({
          taskId: 'task-123',
          runId: 'run-456',
          status: 'running'
        })
      );
    });
  });

  describe('publishTaskProgress', () => {
    it('should broadcast task:progress event with valid progress', () => {
      publishTaskProgress('task-123', 'run-456', 50);

      expect(broadcast).toHaveBeenCalledWith(WS_EVENTS.TASK_PROGRESS, {
        taskId: 'task-123',
        runId: 'run-456',
        progress: 50
      });
    });

    it('should clamp progress to 0-100 range', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Test over 100
      publishTaskProgress('task-123', 'run-456', 150);
      expect(broadcast).toHaveBeenCalledWith(WS_EVENTS.TASK_PROGRESS, {
        taskId: 'task-123',
        runId: 'run-456',
        progress: 100
      });

      // Test under 0
      publishTaskProgress('task-123', 'run-456', -10);
      expect(broadcast).toHaveBeenCalledWith(WS_EVENTS.TASK_PROGRESS, {
        taskId: 'task-123',
        runId: 'run-456',
        progress: 0
      });

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });
  });

  describe('publishTaskCompleted', () => {
    it('should broadcast task:completed event with result', () => {
      const result = { output: 'success', files_changed: 5 };

      publishTaskCompleted('task-123', 'run-456', result);

      expect(broadcast).toHaveBeenCalledWith(
        WS_EVENTS.TASK_COMPLETED,
        expect.objectContaining({
          taskId: 'task-123',
          runId: 'run-456',
          status: 'completed',
          result
        })
      );
    });

    it('should handle empty result', () => {
      publishTaskCompleted('task-123', 'run-456');

      expect(broadcast).toHaveBeenCalledWith(
        WS_EVENTS.TASK_COMPLETED,
        expect.objectContaining({
          taskId: 'task-123',
          runId: 'run-456',
          status: 'completed',
          result: {}
        })
      );
    });
  });

  describe('publishTaskFailed', () => {
    it('should broadcast task:failed event with error', () => {
      publishTaskFailed('task-123', 'run-456', 'Network timeout');

      expect(broadcast).toHaveBeenCalledWith(
        WS_EVENTS.TASK_FAILED,
        expect.objectContaining({
          taskId: 'task-123',
          runId: 'run-456',
          status: 'failed',
          error: 'Network timeout'
        })
      );
    });
  });

  describe('publishExecutorStatus', () => {
    it('should broadcast executor:status event with resource info', () => {
      publishExecutorStatus(3, 2, 5);

      expect(broadcast).toHaveBeenCalledWith(
        WS_EVENTS.EXECUTOR_STATUS,
        expect.objectContaining({
          activeCount: 3,
          availableSlots: 2,
          maxConcurrent: 5
        })
      );
    });
  });
});
