/**
 * PRProgressDashboard 组件测试
 * 验证：PR 计数器显示、KR 进度、失败任务列表、加载/错误状态
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { PRProgressDashboard } from './PRProgressDashboard';

// ── mock 数据 ──────────────────────────────────────────────────────────────────

const mockCompletedTasks = [
  {
    id: '1',
    title: '实现登录功能',
    status: 'completed',
    task_type: 'dev',
    completed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: '2',
    title: '修复 CI 失败',
    status: 'completed',
    task_type: 'dev',
    completed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
];

const mockFailedTasks = [
  {
    id: '10',
    title: '部署到生产环境',
    status: 'failed',
    task_type: 'dev',
    completed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    metadata: { error: '连接超时' },
  },
];

const mockGoal = {
  id: 'e5ec0510-d7b2-4ee7-99f6-314aac55b3f6',
  title: 'Cecelia 每日自主派发 30+ 任务',
  progress: 20,
  status: 'in_progress',
  priority: 'P0',
};

// ── mock fetch 工具 ────────────────────────────────────────────────────────────

function makeMockResponse(ok: boolean, data: unknown): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(data),
  } as Response;
}

interface SetupFetchOpts {
  completedTasks?: object[];
  failedTasks?: object[];
  goal?: object | null;
  completedOk?: boolean;
  failedOk?: boolean;
  goalOk?: boolean;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

function setupMockFetch(opts: SetupFetchOpts = {}) {
  const {
    completedTasks = mockCompletedTasks,
    failedTasks = mockFailedTasks,
    goal = mockGoal,
    completedOk = true,
    failedOk = true,
    goalOk = true,
  } = opts;

  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request): Promise<Response> => {
    const urlStr = url.toString();
    if (urlStr.includes('status=completed')) {
      return Promise.resolve(makeMockResponse(completedOk, completedOk ? completedTasks : {}));
    }
    if (urlStr.includes('status=failed')) {
      return Promise.resolve(makeMockResponse(failedOk, failedOk ? failedTasks : {}));
    }
    if (urlStr.includes('/api/brain/goals/')) {
      return Promise.resolve(makeMockResponse(goalOk, goalOk ? goal : {}));
    }
    return Promise.reject(new Error(`Unknown URL: ${urlStr}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('PRProgressDashboard', () => {
  it('加载时显示加载状态', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}) as Promise<Response>
    );

    render(<PRProgressDashboard />);

    expect(screen.getByText('加载 PR 进度数据...')).toBeInTheDocument();
  });

  it('成功加载后显示 PR 计数', async () => {
    setupMockFetch({ completedTasks: mockCompletedTasks });

    render(<PRProgressDashboard />);

    await waitFor(() => {
      // 显示本月 PR 数量（2 个）
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('显示目标数量（/ 30）', async () => {
    setupMockFetch({});

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('/ 30')).toBeInTheDocument();
    });
  });

  it('进度条 aria 属性正确', async () => {
    setupMockFetch({ completedTasks: mockCompletedTasks });

    render(<PRProgressDashboard />);

    await waitFor(() => {
      const bars = screen.getAllByRole('progressbar');
      expect(bars.length).toBeGreaterThan(0);
      // 2/30 = 6.666...% → Math.round = 7
      const prBar = bars[0];
      expect(Number(prBar.getAttribute('aria-valuenow'))).toBe(7);
    });
  });

  it('显示 KR 目标标题', async () => {
    setupMockFetch({});

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Cecelia 每日自主派发 30+ 任务')).toBeInTheDocument();
    });
  });

  it('KR 不存在时显示"KR 未找到"', async () => {
    setupMockFetch({ goal: null, goalOk: false });

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('KR 未找到')).toBeInTheDocument();
    });
  });

  it('显示失败任务列表', async () => {
    setupMockFetch({});

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('部署到生产环境')).toBeInTheDocument();
    });
  });

  it('失败任务显示错误原因', async () => {
    setupMockFetch({});

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('连接超时')).toBeInTheDocument();
    });
  });

  it('无失败任务时显示"无失败任务"', async () => {
    setupMockFetch({ failedTasks: [] });

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('无失败任务')).toBeInTheDocument();
    });
  });

  it('显示趋势图标题', async () => {
    setupMockFetch({});

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('过去 7 天 PR 产出趋势')).toBeInTheDocument();
    });
  });

  it('所有 API HTTP 错误时仍然正常渲染（降级空数据）', async () => {
    setupMockFetch({ completedOk: false, failedOk: false, goalOk: false });

    render(<PRProgressDashboard />);

    await waitFor(() => {
      // 降级展示：KR 未找到 + 无失败任务
      expect(screen.getByText('KR 未找到')).toBeInTheDocument();
      expect(screen.getByText('无失败任务')).toBeInTheDocument();
    });
  });

  it('refreshInterval 控制自动刷新间隔', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMockFetch({});

    render(<PRProgressDashboard refreshInterval={30000} />);

    await act(async () => {
      await Promise.resolve();
    });

    // 初始加载：3 次 API 调用（completed、failed、goal）
    const initialCalls = fetchSpy.mock.calls.length;
    expect(initialCalls).toBe(3);

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
    });

    // 再次刷新：又 3 次 API 调用
    expect(fetchSpy.mock.calls.length).toBe(6);

    vi.useRealTimers();
  });

  it('显示 PR 进度看板标题', async () => {
    setupMockFetch({});

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('PR 进度看板')).toBeInTheDocument();
    });
  });

  it('PR 计数模块显示本月字样', async () => {
    setupMockFetch({});

    render(<PRProgressDashboard />);

    await waitFor(() => {
      expect(screen.getByText('本月自主 PR 进度')).toBeInTheDocument();
    });
  });
});
