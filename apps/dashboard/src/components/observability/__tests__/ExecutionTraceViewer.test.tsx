import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExecutionTraceViewer } from '../ExecutionTraceViewer';
import * as observabilityApi from '../../../api/observability.api';
import '@testing-library/jest-dom';

vi.mock('../../../api/observability.api');

describe('ExecutionTraceViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show prompt to select run when no runId provided', () => {
    render(<ExecutionTraceViewer runId={null} />);

    expect(screen.getByText('Select a run to view execution trace')).toBeInTheDocument();
  });

  it('should show loading state when fetching trace', () => {
    (observabilityApi.observabilityApi.getRun as any).mockImplementation(
      () => new Promise(() => {})
    );

    render(<ExecutionTraceViewer runId="run1" />);

    expect(screen.getByText('Loading trace...')).toBeInTheDocument();
  });

  it('should fetch and display execution trace', async () => {
    const mockEvents = [
      {
        id: 1,
        run_id: 'run1',
        layer: 'L0_orchestrator',
        step_name: 'schedule',
        status: 'success',
        attempt: 1,
        executor_host: 'host1',
        reason_code: null,
        reason_kind: null,
      },
      {
        id: 2,
        run_id: 'run1',
        layer: 'L2_executor',
        step_name: 'code',
        status: 'failed',
        attempt: 1,
        executor_host: 'host2',
        reason_code: 'TIMEOUT',
        reason_kind: 'TRANSIENT',
      },
    ];

    (observabilityApi.observabilityApi.getRun as any).mockResolvedValue({
      data: { success: true, data: mockEvents },
    });

    render(<ExecutionTraceViewer runId="run1" />);

    await waitFor(() => {
      expect(screen.getByText(/Execution Trace/i)).toBeInTheDocument();
      expect(screen.getByText(/2 spans/i)).toBeInTheDocument();
    });

    expect(screen.getByText('schedule')).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.getByText('TRANSIENT: TIMEOUT')).toBeInTheDocument();
  });

  it('should show error state on API failure', async () => {
    (observabilityApi.observabilityApi.getRun as any).mockRejectedValue(
      new Error('Failed to fetch trace')
    );

    render(<ExecutionTraceViewer runId="run1" />);

    await waitFor(() => {
      expect(screen.getByText(/Error/i)).toBeInTheDocument();
      expect(screen.getByText(/Failed to fetch trace/i)).toBeInTheDocument();
    });
  });

  it('should display layer badges with correct colors', async () => {
    const mockEvents = [
      {
        id: 1,
        run_id: 'run1',
        layer: 'L0_orchestrator',
        step_name: 'schedule',
        status: 'success',
        attempt: 1,
        executor_host: 'host1',
        reason_code: null,
        reason_kind: null,
      },
    ];

    (observabilityApi.observabilityApi.getRun as any).mockResolvedValue({
      data: { success: true, data: mockEvents },
    });

    render(<ExecutionTraceViewer runId="run1" />);

    await waitFor(() => {
      const layerBadge = screen.getByText('L0_orchestrator');
      expect(layerBadge).toHaveClass('bg-purple-100', 'text-purple-800');
    });
  });

  it('should display status badges with correct colors', async () => {
    const mockEvents = [
      {
        id: 1,
        run_id: 'run1',
        layer: 'L1_brain',
        step_name: 'analyze',
        status: 'success',
        attempt: 1,
        executor_host: 'host1',
        reason_code: null,
        reason_kind: null,
      },
      {
        id: 2,
        run_id: 'run1',
        layer: 'L2_executor',
        step_name: 'execute',
        status: 'failed',
        attempt: 1,
        executor_host: 'host2',
        reason_code: 'ERROR',
        reason_kind: 'PERSISTENT',
      },
    ];

    (observabilityApi.observabilityApi.getRun as any).mockResolvedValue({
      data: { success: true, data: mockEvents },
    });

    render(<ExecutionTraceViewer runId="run1" />);

    await waitFor(() => {
      const successBadge = screen.getByText('success');
      const failedBadge = screen.getByText('failed');
      expect(successBadge).toHaveClass('bg-green-100', 'text-green-800');
      expect(failedBadge).toHaveClass('bg-red-100', 'text-red-800');
    });
  });

  it('should show attempt number', async () => {
    const mockEvents = [
      {
        id: 1,
        run_id: 'run1',
        layer: 'L2_executor',
        step_name: 'test',
        status: 'success',
        attempt: 3,
        executor_host: 'host1',
        reason_code: null,
        reason_kind: null,
      },
    ];

    (observabilityApi.observabilityApi.getRun as any).mockResolvedValue({
      data: { success: true, data: mockEvents },
    });

    render(<ExecutionTraceViewer runId="run1" />);

    await waitFor(() => {
      expect(screen.getByText(/Attempt #3/i)).toBeInTheDocument();
    });
  });

  it('should re-fetch when runId changes', async () => {
    const mockEvents1 = [
      {
        id: 1,
        run_id: 'run1',
        layer: 'L0_orchestrator',
        step_name: 'schedule1',
        status: 'success',
        attempt: 1,
        executor_host: 'host1',
        reason_code: null,
        reason_kind: null,
      },
    ];

    const mockEvents2 = [
      {
        id: 2,
        run_id: 'run2',
        layer: 'L0_orchestrator',
        step_name: 'schedule2',
        status: 'success',
        attempt: 1,
        executor_host: 'host1',
        reason_code: null,
        reason_kind: null,
      },
    ];

    (observabilityApi.observabilityApi.getRun as any)
      .mockResolvedValueOnce({ data: { success: true, data: mockEvents1 } })
      .mockResolvedValueOnce({ data: { success: true, data: mockEvents2 } });

    const { rerender } = render(<ExecutionTraceViewer runId="run1" />);

    await waitFor(() => {
      expect(screen.getByText('schedule1')).toBeInTheDocument();
    });

    rerender(<ExecutionTraceViewer runId="run2" />);

    await waitFor(() => {
      expect(screen.getByText('schedule2')).toBeInTheDocument();
    });

    expect(observabilityApi.observabilityApi.getRun).toHaveBeenCalledTimes(2);
  });
});
