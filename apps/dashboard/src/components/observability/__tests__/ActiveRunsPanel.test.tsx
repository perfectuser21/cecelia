import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ActiveRunsPanel } from '../ActiveRunsPanel';
import * as observabilityApi from '../../../api/observability.api';
import '@testing-library/jest-dom';

vi.mock('../../../api/observability.api');

describe('ActiveRunsPanel', () => {
  const mockOnSelectRun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show loading state initially', () => {
    (observabilityApi.observabilityApi.getActiveRuns as any).mockImplementation(
      () => new Promise(() => {})
    );

    render(<ActiveRunsPanel onSelectRun={mockOnSelectRun} selectedRunId={null} />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should fetch and display active runs', async () => {
    const mockRuns = [
      {
        run_id: 'run12345',
        task_id: 'task1',
        last_span_id: 'span1',
        layer: 'L2_executor',
        step_name: 'code',
        status: 'running',
        started_at: '2024-01-01T10:00:00Z',
        executor_host: 'host1',
        heartbeat_ts: null,
        seconds_since_activity: 10,
      },
      {
        run_id: 'run67890',
        task_id: 'task2',
        last_span_id: 'span2',
        layer: 'L1_brain',
        step_name: 'plan',
        status: 'running',
        started_at: '2024-01-01T11:00:00Z',
        executor_host: 'host2',
        heartbeat_ts: null,
        seconds_since_activity: 20,
      },
    ];

    (observabilityApi.observabilityApi.getActiveRuns as any).mockResolvedValue({
      data: { success: true, data: mockRuns, count: 2 },
    });

    render(<ActiveRunsPanel onSelectRun={mockOnSelectRun} selectedRunId={null} />);

    await waitFor(() => {
      expect(screen.getByText(/Active Runs \(2\)/i)).toBeInTheDocument();
    });

    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.getByText('plan')).toBeInTheDocument();
    expect(screen.getByText('L2_executor')).toBeInTheDocument();
    expect(screen.getByText('L1_brain')).toBeInTheDocument();
  });

  it('should show error state on API failure', async () => {
    (observabilityApi.observabilityApi.getActiveRuns as any).mockRejectedValue(
      new Error('API Error')
    );

    render(<ActiveRunsPanel onSelectRun={mockOnSelectRun} selectedRunId={null} />);

    await waitFor(() => {
      expect(screen.getByText(/Error/i)).toBeInTheDocument();
      expect(screen.getByText(/API Error/i)).toBeInTheDocument();
    });
  });

  it('should show empty state when no active runs', async () => {
    (observabilityApi.observabilityApi.getActiveRuns as any).mockResolvedValue({
      data: { success: true, data: [], count: 0 },
    });

    render(<ActiveRunsPanel onSelectRun={mockOnSelectRun} selectedRunId={null} />);

    await waitFor(() => {
      expect(screen.getByText(/No active runs/i)).toBeInTheDocument();
    });
  });

  it('should call onSelectRun when a run is clicked', async () => {
    const mockRuns = [
      {
        run_id: 'run12345',
        task_id: 'task1',
        last_span_id: 'span1',
        layer: 'L2_executor',
        step_name: 'code',
        status: 'running',
        started_at: '2024-01-01T10:00:00Z',
        executor_host: 'host1',
        heartbeat_ts: null,
        seconds_since_activity: 10,
      },
    ];

    (observabilityApi.observabilityApi.getActiveRuns as any).mockResolvedValue({
      data: { success: true, data: mockRuns, count: 1 },
    });

    render(<ActiveRunsPanel onSelectRun={mockOnSelectRun} selectedRunId={null} />);

    await waitFor(() => {
      expect(screen.getByText('code')).toBeInTheDocument();
    });

    const runElement = screen.getByText('code').closest('div[class*="cursor-pointer"]');
    if (runElement) {
      runElement.click();
      expect(mockOnSelectRun).toHaveBeenCalledWith('run12345');
    }
  });

  it('should highlight selected run', async () => {
    const mockRuns = [
      {
        run_id: 'run12345',
        task_id: 'task1',
        last_span_id: 'span1',
        layer: 'L2_executor',
        step_name: 'code',
        status: 'running',
        started_at: '2024-01-01T10:00:00Z',
        executor_host: 'host1',
        heartbeat_ts: null,
        seconds_since_activity: 10,
      },
    ];

    (observabilityApi.observabilityApi.getActiveRuns as any).mockResolvedValue({
      data: { success: true, data: mockRuns, count: 1 },
    });

    render(<ActiveRunsPanel onSelectRun={mockOnSelectRun} selectedRunId="run12345" />);

    await waitFor(() => {
      const runElement = screen.getByText('code').closest('div[class*="cursor-pointer"]');
      expect(runElement).toHaveClass('bg-blue-50');
    });
  });

  it('should auto-refresh every 5 seconds', async () => {
    (observabilityApi.observabilityApi.getActiveRuns as any).mockResolvedValue({
      data: { success: true, data: [], count: 0 },
    });

    render(<ActiveRunsPanel onSelectRun={mockOnSelectRun} selectedRunId={null} />);

    await waitFor(() => {
      expect(observabilityApi.observabilityApi.getActiveRuns).toHaveBeenCalledTimes(1);
    });

    // Advance time by 5 seconds
    vi.advanceTimersByTime(5000);

    await waitFor(() => {
      expect(observabilityApi.observabilityApi.getActiveRuns).toHaveBeenCalledTimes(2);
    });
  });
});
