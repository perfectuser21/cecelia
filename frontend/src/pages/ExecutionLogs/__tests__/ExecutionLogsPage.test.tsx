import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ExecutionLogsPage from '../ExecutionLogsPage';
import { brainApi } from '../../../api/brain.api';

// Mock the brainApi
vi.mock('../../../api/brain.api', () => ({
  brainApi: {
    getCeceliaRuns: vi.fn(),
    getCeceliaRunLogs: vi.fn()
  }
}));

describe('ExecutionLogsPage', () => {
  const mockRuns = [
    {
      id: 'run-1',
      task_id: 'task-123',
      status: 'completed' as const,
      created_at: '2026-02-06T01:00:00Z',
      started_at: '2026-02-06T01:01:00Z',
      completed_at: '2026-02-06T01:05:00Z',
      agent: 'caramel'
    },
    {
      id: 'run-2',
      task_id: 'task-456',
      status: 'running' as const,
      created_at: '2026-02-06T02:00:00Z',
      started_at: '2026-02-06T02:01:00Z',
      agent: 'cecelia'
    }
  ];

  const mockLogs = {
    success: true,
    run: mockRuns[0],
    logs: ['Log line 1', 'Log line 2', 'Log line 3'],
    totalLines: 3
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(brainApi.getCeceliaRuns).mockResolvedValue({
      success: true,
      runs: mockRuns,
      total: mockRuns.length
    });
  });

  it('renders page title and description', async () => {
    render(<ExecutionLogsPage />);

    expect(screen.getByText('执行日志')).toBeInTheDocument();
    expect(screen.getByText('查看 Cecelia 任务执行日志')).toBeInTheDocument();
  });

  it('fetches and displays runs list', async () => {
    render(<ExecutionLogsPage />);

    await waitFor(() => {
      expect(screen.getByText('task-123')).toBeInTheDocument();
      expect(screen.getByText('task-456')).toBeInTheDocument();
    });

    expect(brainApi.getCeceliaRuns).toHaveBeenCalled();
  });

  it('shows loading state initially', () => {
    render(<ExecutionLogsPage />);

    expect(screen.getByRole('img', { hidden: true })).toHaveClass('animate-spin');
  });

  it('shows error message when API fails', async () => {
    vi.mocked(brainApi.getCeceliaRuns).mockRejectedValue(new Error('API Error'));

    render(<ExecutionLogsPage />);

    await waitFor(() => {
      expect(screen.getByText('获取任务列表失败')).toBeInTheDocument();
    });
  });

  it('shows empty state when no runs available', async () => {
    vi.mocked(brainApi.getCeceliaRuns).mockResolvedValue({
      success: true,
      runs: [],
      total: 0
    });

    render(<ExecutionLogsPage />);

    await waitFor(() => {
      expect(screen.getByText('暂无任务记录')).toBeInTheDocument();
    });
  });

  it('displays correct run count in list header', async () => {
    render(<ExecutionLogsPage />);

    await waitFor(() => {
      expect(screen.getByText('任务列表 (2)')).toBeInTheDocument();
    });
  });

  it('shows select prompt when no run is selected', async () => {
    render(<ExecutionLogsPage />);

    await waitFor(() => {
      expect(screen.getByText('请选择一个任务查看日志')).toBeInTheDocument();
    });
  });

  it('displays status badges correctly', async () => {
    render(<ExecutionLogsPage />);

    await waitFor(() => {
      expect(screen.getByText('已完成')).toBeInTheDocument();
      expect(screen.getByText('运行中')).toBeInTheDocument();
    });
  });

  it('calls API with correct filters', async () => {
    render(<ExecutionLogsPage />);

    await waitFor(() => {
      expect(brainApi.getCeceliaRuns).toHaveBeenCalledWith({
        status: undefined,
        limit: 50
      });
    });
  });

  it('renders filter component', () => {
    render(<ExecutionLogsPage />);

    expect(screen.getByPlaceholderText('输入任务 ID')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入关键词搜索日志...')).toBeInTheDocument();
  });
});
