import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecutionStatus } from '../ExecutionStatus';
import { brainApi } from '../../../../../api/brain.api';

// Mock the brain API
vi.mock('../../../../../api/brain.api', () => ({
  brainApi: {
    getVpsSlots: vi.fn(),
  },
}));

describe('ExecutionStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should display loading state initially', () => {
    vi.mocked(brainApi.getVpsSlots).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<ExecutionStatus />);

    expect(screen.getByText(/Loading execution status/i)).toBeInTheDocument();
  });

  it('should display error state when API fails', async () => {
    vi.mocked(brainApi.getVpsSlots).mockRejectedValue(
      new Error('Network error')
    );

    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  it('should display active tasks when data is loaded', async () => {
    const mockSlots = [
      {
        pid: 1234,
        cpu: '45.5',
        memory: '256 MB',
        startTime: '2026-02-06T10:00:00Z',
        taskId: 'task-001',
        runId: 'run-001',
        startedAt: '2026-02-06T10:00:00Z',
        command: 'npm test',
        taskTitle: 'Test Task 1',
        taskPriority: 'P1',
        taskType: 'short',
      },
      {
        pid: 5678,
        cpu: '30.2',
        memory: '512 MB',
        startTime: '2026-02-06T09:00:00Z',
        taskId: 'task-002',
        runId: 'run-002',
        startedAt: '2026-02-06T09:00:00Z',
        command: 'npm build',
        taskTitle: 'Build Task',
        taskPriority: 'P0',
        taskType: 'long',
      },
    ];

    vi.mocked(brainApi.getVpsSlots).mockResolvedValue({
      success: true,
      total: 6,
      used: 2,
      available: 4,
      slots: mockSlots,
    });

    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Test Task 1')).toBeInTheDocument();
      expect(screen.getByText('Build Task')).toBeInTheDocument();
      expect(screen.getByText('2 active tasks running')).toBeInTheDocument();
    });
  });

  it('should display empty state when no active tasks', async () => {
    vi.mocked(brainApi.getVpsSlots).mockResolvedValue({
      success: true,
      total: 6,
      used: 0,
      available: 6,
      slots: [],
    });

    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText(/No active tasks/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Tasks will appear here when they start executing/i)
      ).toBeInTheDocument();
    });
  });

  it('should auto-refresh data at specified interval', async () => {
    vi.mocked(brainApi.getVpsSlots).mockResolvedValue({
      success: true,
      total: 6,
      used: 0,
      available: 6,
      slots: [],
    });

    render(<ExecutionStatus autoRefresh={true} refreshInterval={5000} />);

    // Initial load
    await waitFor(() => {
      expect(brainApi.getVpsSlots).toHaveBeenCalledTimes(1);
    });

    // Advance time by 5 seconds
    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(brainApi.getVpsSlots).toHaveBeenCalledTimes(2);
    });
  });

  it('should not auto-refresh when autoRefresh is false', async () => {
    vi.mocked(brainApi.getVpsSlots).mockResolvedValue({
      success: true,
      total: 6,
      used: 0,
      available: 6,
      slots: [],
    });

    render(<ExecutionStatus autoRefresh={false} />);

    // Initial load
    await waitFor(() => {
      expect(brainApi.getVpsSlots).toHaveBeenCalledTimes(1);
    });

    // Advance time by 10 seconds
    vi.advanceTimersByTime(10000);

    // Should still be only 1 call
    expect(brainApi.getVpsSlots).toHaveBeenCalledTimes(1);
  });

  it('should refresh manually when refresh button is clicked', async () => {
    const user = userEvent.setup({ delay: null });

    vi.mocked(brainApi.getVpsSlots).mockResolvedValue({
      success: true,
      total: 6,
      used: 0,
      available: 6,
      slots: [],
    });

    render(<ExecutionStatus autoRefresh={false} />);

    // Initial load
    await waitFor(() => {
      expect(brainApi.getVpsSlots).toHaveBeenCalledTimes(1);
    });

    // Click refresh button
    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(brainApi.getVpsSlots).toHaveBeenCalledTimes(2);
    });
  });

  it('should filter out slots with no taskId', async () => {
    const mockSlots = [
      {
        pid: 1234,
        cpu: '45.5',
        memory: '256 MB',
        startTime: '2026-02-06T10:00:00Z',
        taskId: 'task-001',
        runId: 'run-001',
        startedAt: '2026-02-06T10:00:00Z',
        command: 'npm test',
        taskTitle: 'Active Task',
        taskPriority: 'P1',
        taskType: 'short',
      },
      {
        pid: 5678,
        cpu: '10.0',
        memory: '128 MB',
        startTime: '2026-02-06T09:00:00Z',
        taskId: null,
        runId: null,
        startedAt: null,
        command: 'idle',
        taskTitle: null,
        taskPriority: null,
        taskType: null,
      },
    ];

    vi.mocked(brainApi.getVpsSlots).mockResolvedValue({
      success: true,
      total: 6,
      used: 1,
      available: 5,
      slots: mockSlots,
    });

    render(<ExecutionStatus />);

    await waitFor(() => {
      expect(screen.getByText('Active Task')).toBeInTheDocument();
      expect(screen.queryByText('idle')).not.toBeInTheDocument();
      expect(screen.getByText('1 active task running')).toBeInTheDocument();
    });
  });
});
