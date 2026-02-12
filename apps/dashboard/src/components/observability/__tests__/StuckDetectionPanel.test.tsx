import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StuckDetectionPanel } from '../StuckDetectionPanel';
import * as observabilityApi from '../../../api/observability.api';
import '@testing-library/jest-dom';

vi.mock('../../../api/observability.api');

describe('StuckDetectionPanel', () => {
  const mockOnSelectRun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show loading state initially', () => {
    (observabilityApi.observabilityApi.getStuckRuns as any).mockImplementation(
      () => new Promise(() => {})
    );

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should fetch and display stuck runs', async () => {
    const mockStuckRuns = [
      {
        run_id: 'stuck1',
        layer: 'L2_executor',
        step_name: 'code',
        stuck_duration_seconds: 360,
        executor_host: 'host1',
      },
      {
        run_id: 'stuck2',
        layer: 'L1_brain',
        step_name: 'analyze',
        stuck_duration_seconds: 720,
        executor_host: 'host2',
      },
    ];

    (observabilityApi.observabilityApi.getStuckRuns as any).mockResolvedValue({
      data: { success: true, data: mockStuckRuns },
    });

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    await waitFor(() => {
      expect(screen.getByText(/⚠️ Stuck Runs Detected \(2\)/i)).toBeInTheDocument();
    });

    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.getByText('analyze')).toBeInTheDocument();
    expect(screen.getByText(/Stuck for 6m/i)).toBeInTheDocument(); // 360/60 = 6
    expect(screen.getByText(/Stuck for 12m/i)).toBeInTheDocument(); // 720/60 = 12
  });

  it('should show success state when no stuck runs', async () => {
    (observabilityApi.observabilityApi.getStuckRuns as any).mockResolvedValue({
      data: { success: true, data: [] },
    });

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    await waitFor(() => {
      expect(screen.getByText(/✅ No stuck runs detected/i)).toBeInTheDocument();
    });
  });

  it('should show error state on API failure', async () => {
    (observabilityApi.observabilityApi.getStuckRuns as any).mockRejectedValue(
      new Error('API Error')
    );

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    await waitFor(() => {
      expect(screen.getByText(/Error/i)).toBeInTheDocument();
      expect(screen.getByText(/API Error/i)).toBeInTheDocument();
    });
  });

  it('should call onSelectRun when a stuck run is clicked', async () => {
    const mockStuckRuns = [
      {
        run_id: 'stuck1',
        layer: 'L2_executor',
        step_name: 'code',
        stuck_duration_seconds: 360,
        executor_host: 'host1',
      },
    ];

    (observabilityApi.observabilityApi.getStuckRuns as any).mockResolvedValue({
      data: { success: true, data: mockStuckRuns },
    });

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    await waitFor(() => {
      expect(screen.getByText('code')).toBeInTheDocument();
    });

    const runElement = screen.getByText('code').closest('div[class*="cursor-pointer"]');
    if (runElement) {
      fireEvent.click(runElement);
      expect(mockOnSelectRun).toHaveBeenCalledWith('stuck1');
    }
  });

  it('should display run ID truncated', async () => {
    const mockStuckRuns = [
      {
        run_id: 'very-long-run-id-12345678901234567890',
        layer: 'L2_executor',
        step_name: 'code',
        stuck_duration_seconds: 360,
        executor_host: 'host1',
      },
    ];

    (observabilityApi.observabilityApi.getStuckRuns as any).mockResolvedValue({
      data: { success: true, data: mockStuckRuns },
    });

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    await waitFor(() => {
      // Should show first 12 chars + ...
      expect(screen.getByText(/very-long-ru.../i)).toBeInTheDocument();
    });
  });

  it('should display executor host', async () => {
    const mockStuckRuns = [
      {
        run_id: 'stuck1',
        layer: 'L2_executor',
        step_name: 'code',
        stuck_duration_seconds: 360,
        executor_host: 'production-server-1',
      },
    ];

    (observabilityApi.observabilityApi.getStuckRuns as any).mockResolvedValue({
      data: { success: true, data: mockStuckRuns },
    });

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    await waitFor(() => {
      expect(screen.getByText('production-server-1')).toBeInTheDocument();
    });
  });

  it('should display layer and step name', async () => {
    const mockStuckRuns = [
      {
        run_id: 'stuck1',
        layer: 'L3_browser',
        step_name: 'navigate',
        stuck_duration_seconds: 360,
        executor_host: 'host1',
      },
    ];

    (observabilityApi.observabilityApi.getStuckRuns as any).mockResolvedValue({
      data: { success: true, data: mockStuckRuns },
    });

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    await waitFor(() => {
      expect(screen.getByText('L3_browser')).toBeInTheDocument();
      expect(screen.getByText('navigate')).toBeInTheDocument();
    });
  });

  it('should auto-refresh every 10 seconds', async () => {
    (observabilityApi.observabilityApi.getStuckRuns as any).mockResolvedValue({
      data: { success: true, data: [] },
    });

    render(<StuckDetectionPanel onSelectRun={mockOnSelectRun} />);

    await waitFor(() => {
      expect(observabilityApi.observabilityApi.getStuckRuns).toHaveBeenCalledTimes(1);
    });

    // Advance time by 10 seconds
    vi.advanceTimersByTime(10000);

    await waitFor(() => {
      expect(observabilityApi.observabilityApi.getStuckRuns).toHaveBeenCalledTimes(2);
    });
  });
});
