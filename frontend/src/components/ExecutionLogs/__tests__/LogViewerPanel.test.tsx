import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LogViewerPanel } from '../LogViewerPanel';

describe('LogViewerPanel', () => {
  const mockLogs = [
    'INFO: Starting task execution',
    'ERROR: Failed to connect to database',
    'WARN: Retry attempt 1',
    'SUCCESS: Task completed'
  ];

  it('renders log viewer with correct log count', () => {
    render(
      <LogViewerPanel
        logs={mockLogs}
        runId="test-run-123"
        status="completed"
      />
    );

    expect(screen.getByText('执行日志')).toBeInTheDocument();
    expect(screen.getByText('(4 行)')).toBeInTheDocument();
  });

  it('displays all logs', () => {
    render(
      <LogViewerPanel
        logs={mockLogs}
        runId="test-run-123"
        status="completed"
      />
    );

    mockLogs.forEach(log => {
      expect(screen.getByText(log)).toBeInTheDocument();
    });
  });

  it('shows running indicator when status is running', () => {
    render(
      <LogViewerPanel
        logs={mockLogs}
        runId="test-run-123"
        status="running"
      />
    );

    expect(screen.getByText('运行中')).toBeInTheDocument();
  });

  it('filters logs by search text', () => {
    render(
      <LogViewerPanel
        logs={mockLogs}
        runId="test-run-123"
        status="completed"
        searchText="ERROR"
      />
    );

    expect(screen.getByText(/Failed to connect/)).toBeInTheDocument();
    expect(screen.queryByText(/Starting task/)).not.toBeInTheDocument();
  });

  it('shows empty state when no logs match search', () => {
    render(
      <LogViewerPanel
        logs={mockLogs}
        runId="test-run-123"
        status="completed"
        searchText="NONEXISTENT"
      />
    );

    expect(screen.getByText('没有匹配的日志')).toBeInTheDocument();
  });

  it('toggles auto-scroll when button is clicked', () => {
    render(
      <LogViewerPanel
        logs={mockLogs}
        runId="test-run-123"
        status="completed"
      />
    );

    const autoScrollButton = screen.getByTitle('禁用自动滚动');
    expect(autoScrollButton).toBeInTheDocument();

    fireEvent.click(autoScrollButton);

    expect(screen.getByTitle('启用自动滚动')).toBeInTheDocument();
  });

  it('triggers download when download button is clicked', () => {
    // Mock URL.createObjectURL and related DOM APIs
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement');

    render(
      <LogViewerPanel
        logs={mockLogs}
        runId="test-run-123"
        status="completed"
      />
    );

    const downloadButton = screen.getByTitle('下载日志');
    fireEvent.click(downloadButton);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });

  it('shows empty state when no logs provided', () => {
    render(
      <LogViewerPanel
        logs={[]}
        runId="test-run-123"
        status="completed"
      />
    );

    expect(screen.getByText('暂无日志')).toBeInTheDocument();
  });
});
