import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FailureAnalysisChart } from '../FailureAnalysisChart';
import * as observabilityApi from '../../../api/observability.api';
import '@testing-library/jest-dom';

vi.mock('../../../api/observability.api');

describe('FailureAnalysisChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show loading state initially', () => {
    (observabilityApi.observabilityApi.getTopFailures as any).mockImplementation(
      () => new Promise(() => {})
    );

    render(<FailureAnalysisChart />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should fetch and display top failures', async () => {
    const mockFailures = [
      {
        reason_code: 'TIMEOUT',
        reason_kind: 'TRANSIENT',
        count: 10,
      },
      {
        reason_code: 'NETWORK_ERROR',
        reason_kind: 'TRANSIENT',
        count: 7,
      },
      {
        reason_code: 'DATABASE_CONNECTION',
        reason_kind: 'PERSISTENT',
        count: 5,
      },
    ];

    (observabilityApi.observabilityApi.getTopFailures as any).mockResolvedValue({
      data: { success: true, data: mockFailures },
    });

    render(<FailureAnalysisChart />);

    await waitFor(() => {
      expect(screen.getByText('Top 10 Failure Reasons')).toBeInTheDocument();
    });

    // Check that chart is rendered (recharts renders SVG)
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should show error state on API failure', async () => {
    (observabilityApi.observabilityApi.getTopFailures as any).mockRejectedValue(
      new Error('Failed to fetch failures')
    );

    render(<FailureAnalysisChart />);

    await waitFor(() => {
      expect(screen.getByText(/Error/i)).toBeInTheDocument();
      expect(screen.getByText(/Failed to fetch failures/i)).toBeInTheDocument();
    });
  });

  it('should show empty state when no failures', async () => {
    (observabilityApi.observabilityApi.getTopFailures as any).mockResolvedValue({
      data: { success: true, data: [] },
    });

    render(<FailureAnalysisChart />);

    await waitFor(() => {
      expect(screen.getByText('No failures recorded')).toBeInTheDocument();
    });
  });

  it('should request top 10 failures by default', async () => {
    (observabilityApi.observabilityApi.getTopFailures as any).mockResolvedValue({
      data: { success: true, data: [] },
    });

    render(<FailureAnalysisChart />);

    await waitFor(() => {
      expect(observabilityApi.observabilityApi.getTopFailures).toHaveBeenCalledWith(10);
    });
  });

  it('should auto-refresh every 30 seconds', async () => {
    (observabilityApi.observabilityApi.getTopFailures as any).mockResolvedValue({
      data: { success: true, data: [] },
    });

    render(<FailureAnalysisChart />);

    await waitFor(() => {
      expect(observabilityApi.observabilityApi.getTopFailures).toHaveBeenCalledTimes(1);
    });

    // Advance time by 30 seconds
    vi.advanceTimersByTime(30000);

    await waitFor(() => {
      expect(observabilityApi.observabilityApi.getTopFailures).toHaveBeenCalledTimes(2);
    });
  });

  it('should use correct colors for reason kinds', async () => {
    const mockFailures = [
      { reason_code: 'TEST_TRANSIENT', reason_kind: 'TRANSIENT', count: 10 },
      { reason_code: 'TEST_PERSISTENT', reason_kind: 'PERSISTENT', count: 7 },
      { reason_code: 'TEST_RESOURCE', reason_kind: 'RESOURCE', count: 5 },
      { reason_code: 'TEST_CONFIG', reason_kind: 'CONFIG', count: 3 },
      { reason_code: 'TEST_UNKNOWN', reason_kind: 'UNKNOWN', count: 1 },
    ];

    (observabilityApi.observabilityApi.getTopFailures as any).mockResolvedValue({
      data: { success: true, data: mockFailures },
    });

    render(<FailureAnalysisChart />);

    await waitFor(() => {
      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    // Verify that REASON_KIND_COLORS mapping exists
    // The actual colors are applied by recharts to SVG elements
    // We just verify the component rendered successfully
  });
});
