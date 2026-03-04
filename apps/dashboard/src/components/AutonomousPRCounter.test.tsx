/**
 * AutonomousPRCounter 组件测试
 * 验证：颜色规则、百分比显示、错误状态、自动刷新
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AutonomousPRCounter } from './AutonomousPRCounter';

function mockFetchResponse(data: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  }) as any;
}

function mockFetchError() {
  global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AutonomousPRCounter', () => {
  it('渲染标题"本月自主 PR"', async () => {
    mockFetchResponse({ completed_count: 10, target: 50, month: '2026-03', percentage: 20 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      expect(screen.getByText('本月自主 PR')).toBeInTheDocument();
    });
  });

  it('显示 completed/target 计数', async () => {
    mockFetchResponse({ completed_count: 20, target: 50, month: '2026-03', percentage: 40 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      expect(screen.getByText('20 / 50')).toBeInTheDocument();
    });
  });

  it('0-30% 时进度条为红色', async () => {
    mockFetchResponse({ completed_count: 5, target: 50, month: '2026-03', percentage: 10 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      const bar = screen.getByRole('progressbar');
      expect(bar.className).toContain('bg-red-500');
    });
  });

  it('30-70% 时进度条为黄色', async () => {
    mockFetchResponse({ completed_count: 25, target: 50, month: '2026-03', percentage: 50 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      const bar = screen.getByRole('progressbar');
      expect(bar.className).toContain('bg-yellow-500');
    });
  });

  it('70-100% 时进度条为绿色', async () => {
    mockFetchResponse({ completed_count: 40, target: 50, month: '2026-03', percentage: 80 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      const bar = screen.getByRole('progressbar');
      expect(bar.className).toContain('bg-green-500');
    });
  });

  it('显示正确百分比文本', async () => {
    mockFetchResponse({ completed_count: 35, target: 50, month: '2026-03', percentage: 70 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      expect(screen.getByText('70%')).toBeInTheDocument();
    });
  });

  it('显示剩余数量', async () => {
    mockFetchResponse({ completed_count: 20, target: 50, month: '2026-03', percentage: 40 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      expect(screen.getByText('还差 30 个')).toBeInTheDocument();
    });
  });

  it('完成时剩余数量显示 0 个', async () => {
    mockFetchResponse({ completed_count: 55, target: 50, month: '2026-03', percentage: 100 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      expect(screen.getByText('还差 0 个')).toBeInTheDocument();
    });
  });

  it('API 错误时显示错误信息', async () => {
    mockFetchError();

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      expect(screen.getByText('数据加载失败')).toBeInTheDocument();
    });
  });

  it('每分钟自动刷新（setInterval 60000ms）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchResponse({ completed_count: 10, target: 50, month: '2026-03', percentage: 20 });

    render(<AutonomousPRCounter refreshInterval={60000} />);

    // 等待第一次调用
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    // 经过 60 秒
    await act(async () => {
      vi.advanceTimersByTime(60000);
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('进度条 aria-valuenow 正确', async () => {
    mockFetchResponse({ completed_count: 25, target: 50, month: '2026-03', percentage: 50 });

    render(<AutonomousPRCounter />);

    await waitFor(() => {
      const bar = screen.getByRole('progressbar');
      expect(bar.getAttribute('aria-valuenow')).toBe('50');
    });
  });
});
