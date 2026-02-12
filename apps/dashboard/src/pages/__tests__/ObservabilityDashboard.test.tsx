import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ObservabilityDashboard from '../ObservabilityDashboard';
import * as observabilityApi from '../../api/observability.api';
import '@testing-library/jest-dom';

vi.mock('../../api/observability.api');
vi.mock('../../components/observability/ActiveRunsPanel', () => ({
  ActiveRunsPanel: ({ onSelectRun, selectedRunId }: any) => (
    <div data-testid="active-runs-panel">
      <div>Active Runs Panel</div>
      <button onClick={() => onSelectRun('test-run-id')}>Select Run</button>
      {selectedRunId && <div data-testid="selected-run">{selectedRunId}</div>}
    </div>
  ),
}));

vi.mock('../../components/observability/ExecutionTraceViewer', () => ({
  ExecutionTraceViewer: ({ runId }: any) => (
    <div data-testid="execution-trace-viewer">
      <div>Execution Trace Viewer</div>
      {runId && <div data-testid="trace-run-id">{runId}</div>}
    </div>
  ),
}));

vi.mock('../../components/observability/FailureAnalysisChart', () => ({
  FailureAnalysisChart: () => (
    <div data-testid="failure-analysis-chart">Failure Analysis Chart</div>
  ),
}));

vi.mock('../../components/observability/StuckDetectionPanel', () => ({
  StuckDetectionPanel: ({ onSelectRun }: any) => (
    <div data-testid="stuck-detection-panel">
      <div>Stuck Detection Panel</div>
      <button onClick={() => onSelectRun('stuck-run-id')}>Select Stuck Run</button>
    </div>
  ),
}));

describe('ObservabilityDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dashboard title and description', () => {
    render(<ObservabilityDashboard />);

    expect(screen.getByText('Observability Dashboard')).toBeInTheDocument();
    expect(
      screen.getByText('Real-time execution monitoring and failure analysis')
    ).toBeInTheDocument();
  });

  it('should render all four components', () => {
    render(<ObservabilityDashboard />);

    expect(screen.getByTestId('active-runs-panel')).toBeInTheDocument();
    expect(screen.getByTestId('execution-trace-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('failure-analysis-chart')).toBeInTheDocument();
    expect(screen.getByTestId('stuck-detection-panel')).toBeInTheDocument();
  });

  it('should maintain selectedRunId state', () => {
    render(<ObservabilityDashboard />);

    // Initially no run selected
    expect(screen.queryByTestId('selected-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trace-run-id')).not.toBeInTheDocument();

    // Select a run from ActiveRunsPanel
    const selectButton = screen.getByText('Select Run');
    fireEvent.click(selectButton);

    // Should update selectedRunId
    expect(screen.getByTestId('selected-run')).toHaveTextContent('test-run-id');
    expect(screen.getByTestId('trace-run-id')).toHaveTextContent('test-run-id');
  });

  it('should pass selectedRunId to ActiveRunsPanel', () => {
    render(<ObservabilityDashboard />);

    const selectButton = screen.getByText('Select Run');
    fireEvent.click(selectButton);

    expect(screen.getByTestId('selected-run')).toBeInTheDocument();
  });

  it('should pass selectedRunId to ExecutionTraceViewer', () => {
    render(<ObservabilityDashboard />);

    const selectButton = screen.getByText('Select Run');
    fireEvent.click(selectButton);

    expect(screen.getByTestId('trace-run-id')).toHaveTextContent('test-run-id');
  });

  it('should update selectedRunId when StuckDetectionPanel selects a run', () => {
    render(<ObservabilityDashboard />);

    const selectStuckButton = screen.getByText('Select Stuck Run');
    fireEvent.click(selectStuckButton);

    expect(screen.getByTestId('selected-run')).toHaveTextContent('stuck-run-id');
    expect(screen.getByTestId('trace-run-id')).toHaveTextContent('stuck-run-id');
  });

  it('should have correct grid layout classes', () => {
    const { container } = render(<ObservabilityDashboard />);

    // Check main grid (1 or 3 columns)
    const mainGrid = container.querySelector('.grid.grid-cols-1.lg\\:grid-cols-3');
    expect(mainGrid).toBeInTheDocument();

    // Check bottom row grid (1 or 2 columns)
    const bottomGrid = container.querySelector('.grid.grid-cols-1.lg\\:grid-cols-2');
    expect(bottomGrid).toBeInTheDocument();
  });

  it('should apply correct spacing classes', () => {
    const { container } = render(<ObservabilityDashboard />);

    // Check padding and spacing
    const mainContainer = container.querySelector('.p-6.space-y-6');
    expect(mainContainer).toBeInTheDocument();

    // Check gap classes
    const grids = container.querySelectorAll('.gap-6');
    expect(grids.length).toBeGreaterThan(0);
  });

  it('should apply shadow and rounded styles to panels', () => {
    const { container } = render(<ObservabilityDashboard />);

    const panels = container.querySelectorAll('.bg-white.rounded-lg.shadow');
    // 4 panels: ActiveRuns, ExecutionTrace, FailureAnalysis, StuckDetection
    expect(panels.length).toBe(4);
  });

  it('should set max height for execution trace viewer', () => {
    const { container } = render(<ObservabilityDashboard />);

    const traceContainer = container.querySelector('.max-h-\\[600px\\].overflow-y-auto');
    expect(traceContainer).toBeInTheDocument();
  });
});
