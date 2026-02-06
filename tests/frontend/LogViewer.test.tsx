import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LogViewer from '../../frontend/src/features/core/execution/components/LogViewer';

// Mock fetch
global.fetch = vi.fn();

describe('LogViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: {} }),
    });

    render(<LogViewer />);

    expect(screen.getByText('加载日志中...')).toBeInTheDocument();
  });

  it('fetches and displays logs', async () => {
    const mockLogs = {
      'test-service': '[2024-02-06T10:00:00Z] [INFO] Test log message',
    };

    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: mockLogs }),
    });

    render(<LogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/Test log message/)).toBeInTheDocument();
    });
  });

  it('displays error when fetch fails', async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: false, error: 'Failed to fetch logs' }),
    });

    render(<LogViewer />);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch logs')).toBeInTheDocument();
    });
  });

  it('filters logs by search query', async () => {
    const mockLogs = {
      'test-service': '[2024-02-06T10:00:00Z] [INFO] First message\n[2024-02-06T10:01:00Z] [ERROR] Second message',
    };

    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: mockLogs }),
    });

    render(<LogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/First message/)).toBeInTheDocument();
    });

    // Search for 'ERROR'
    const searchInput = screen.getByPlaceholderText('搜索日志...');
    fireEvent.change(searchInput, { target: { value: 'ERROR' } });

    await waitFor(() => {
      expect(screen.getByText(/Second message/)).toBeInTheDocument();
      expect(screen.queryByText(/First message/)).not.toBeInTheDocument();
    });
  });

  it('filters logs by level', async () => {
    const mockLogs = {
      'test-service': '[2024-02-06T10:00:00Z] [INFO] Info message\n[2024-02-06T10:01:00Z] [ERROR] Error message',
    };

    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: mockLogs }),
    });

    render(<LogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/Info message/)).toBeInTheDocument();
      expect(screen.getByText(/Error message/)).toBeInTheDocument();
    });

    // Expand filter
    const filterButton = screen.getByText('筛选');
    fireEvent.click(filterButton);

    // Unselect INFO
    const infoButton = screen.getByText('INFO');
    fireEvent.click(infoButton);

    await waitFor(() => {
      expect(screen.queryByText(/Info message/)).not.toBeInTheDocument();
      expect(screen.getByText(/Error message/)).toBeInTheDocument();
    });
  });

  it('pauses and resumes log fetching', async () => {
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: {} }),
    });

    render(<LogViewer />);

    await waitFor(() => {
      expect(screen.getByText('暂停')).toBeInTheDocument();
    });

    const pauseButton = screen.getByText('暂停');
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(screen.getByText('恢复')).toBeInTheDocument();
    });
  });

  it('exports logs when export button clicked', async () => {
    const mockLogs = {
      'test-service': '[2024-02-06T10:00:00Z] [INFO] Test message',
    };

    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: mockLogs }),
    });

    // Mock URL.createObjectURL
    const mockCreateObjectURL = vi.fn();
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    // Mock createElement and click
    const mockClick = vi.fn();
    const mockAnchor = { click: mockClick, href: '', download: '' };
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);

    render(<LogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/Test message/)).toBeInTheDocument();
    });

    const exportButton = screen.getByText('导出');
    fireEvent.click(exportButton);

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
  });

  it('clears logs when clear button clicked', async () => {
    const mockLogs = {
      'test-service': '[2024-02-06T10:00:00Z] [INFO] Test message',
    };

    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: mockLogs }),
    });

    render(<LogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/Test message/)).toBeInTheDocument();
    });

    const clearButton = screen.getByText('清空');
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.getByText('暂无日志')).toBeInTheDocument();
    });
  });

  it('parses structured log format correctly', async () => {
    const mockLogs = {
      'test-service': '[2024-02-06T10:00:00Z] [WARN] Warning message',
    };

    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: mockLogs }),
    });

    render(<LogViewer />);

    await waitFor(() => {
      expect(screen.getByText('WARN')).toBeInTheDocument();
      expect(screen.getByText(/Warning message/)).toBeInTheDocument();
    });
  });

  it('handles runId prop for specific run logs', async () => {
    const runId = 'test-run-123';
    (global.fetch as any).mockResolvedValue({
      json: async () => ({ success: true, logs: {} }),
    });

    render(<LogViewer runId={runId} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/cecelia/runs/${runId}/logs`);
    });
  });
});
