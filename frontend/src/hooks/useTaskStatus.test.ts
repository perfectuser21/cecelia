/**
 * Tests for useTaskStatus hook
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTaskStatus } from './useTaskStatus';
import { websocketClient } from '../api/websocket';

// Mock WebSocket
vi.mock('../api/websocket', () => ({
  websocketClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getConnectionState: vi.fn(() => WebSocket.OPEN)
  }
}));

describe('useTaskStatus', () => {
  let messageHandler: ((message: any) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Capture the message handler
    vi.mocked(websocketClient.on).mockImplementation((event, handler) => {
      if (event === '*') {
        messageHandler = handler;
      }
    });
  });

  afterEach(() => {
    messageHandler = null;
  });

  it('should connect to WebSocket on mount', () => {
    renderHook(() => useTaskStatus());

    expect(websocketClient.connect).toHaveBeenCalled();
    expect(websocketClient.on).toHaveBeenCalledWith('*', expect.any(Function));
  });

  it('should track task:created events', async () => {
    const { result } = renderHook(() => useTaskStatus());

    act(() => {
      messageHandler?.({
        event: 'task:created',
        data: {
          taskId: 'task-123',
          title: 'Test Task',
          status: 'queued',
          priority: 'P1'
        },
        timestamp: new Date().toISOString()
      });
    });

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.tasks[0].id).toBe('task-123');
      expect(result.current.tasks[0].status).toBe('queued');
      expect(result.current.tasks[0].title).toBe('Test Task');
    });
  });

  it('should update task status when task:started event received', async () => {
    const { result } = renderHook(() => useTaskStatus());

    // Create task
    act(() => {
      messageHandler?.({
        event: 'task:created',
        data: {
          taskId: 'task-123',
          title: 'Test Task',
          status: 'queued'
        },
        timestamp: new Date().toISOString()
      });
    });

    // Start task
    act(() => {
      messageHandler?.({
        event: 'task:started',
        data: {
          taskId: 'task-123',
          runId: 'run-456',
          status: 'running',
          startedAt: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
    });

    await waitFor(() => {
      const task = result.current.tasks.find(t => t.id === 'task-123');
      expect(task?.status).toBe('in_progress');
      expect(task?.runId).toBe('run-456');
      expect(task?.startedAt).toBeTruthy();
    });
  });

  it('should update progress when task:progress event received', async () => {
    const { result } = renderHook(() => useTaskStatus());

    // Create task
    act(() => {
      messageHandler?.({
        event: 'task:created',
        data: { taskId: 'task-123' },
        timestamp: new Date().toISOString()
      });
    });

    // Update progress
    act(() => {
      messageHandler?.({
        event: 'task:progress',
        data: {
          taskId: 'task-123',
          progress: 75
        },
        timestamp: new Date().toISOString()
      });
    });

    await waitFor(() => {
      const task = result.current.tasks.find(t => t.id === 'task-123');
      expect(task?.progress).toBe(75);
    });
  });

  it('should mark task as completed when task:completed event received', async () => {
    const { result } = renderHook(() => useTaskStatus());

    act(() => {
      messageHandler?.({
        event: 'task:created',
        data: { taskId: 'task-123' },
        timestamp: new Date().toISOString()
      });
    });

    act(() => {
      messageHandler?.({
        event: 'task:completed',
        data: {
          taskId: 'task-123',
          status: 'completed',
          result: { success: true }
        },
        timestamp: new Date().toISOString()
      });
    });

    await waitFor(() => {
      const task = result.current.tasks.find(t => t.id === 'task-123');
      expect(task?.status).toBe('completed');
      expect(task?.result).toEqual({ success: true });
    });
  });

  it('should track executor status updates', async () => {
    const { result } = renderHook(() => useTaskStatus());

    act(() => {
      messageHandler?.({
        event: 'executor:status',
        data: {
          activeCount: 3,
          availableSlots: 2,
          maxConcurrent: 5
        },
        timestamp: new Date().toISOString()
      });
    });

    await waitFor(() => {
      expect(result.current.executorStatus).toEqual({
        activeCount: 3,
        availableSlots: 2,
        maxConcurrent: 5,
        timestamp: expect.any(String)
      });
    });
  });

  it('should filter tasks by taskId when provided', async () => {
    const { result } = renderHook(() => useTaskStatus('task-123'));

    // Create task-123 (should be included)
    act(() => {
      messageHandler?.({
        event: 'task:created',
        data: { taskId: 'task-123', title: 'Task 123' },
        timestamp: new Date().toISOString()
      });
    });

    // Create task-456 (should be filtered out)
    act(() => {
      messageHandler?.({
        event: 'task:created',
        data: { taskId: 'task-456', title: 'Task 456' },
        timestamp: new Date().toISOString()
      });
    });

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.tasks[0].id).toBe('task-123');
    });
  });

  it('should update connection status', async () => {
    vi.mocked(websocketClient.getConnectionState).mockReturnValue(WebSocket.OPEN);

    const { result } = renderHook(() => useTaskStatus());

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
  });

  it('should cleanup on unmount', () => {
    const { unmount } = renderHook(() => useTaskStatus());

    unmount();

    expect(websocketClient.off).toHaveBeenCalledWith('*', expect.any(Function));
  });
});
