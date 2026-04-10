/**
 * CollectionDashboardPage — 数据采集仪表盘集成测试
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';

vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useNavigate: () => vi.fn(),
}));

import CollectionDashboardPage from './CollectionDashboardPage';

const mockCollectionStats = {
  health: {
    overall_inflow_rate: 96.5,
    target_rate: 95,
    healthy: true,
    platforms_with_data: 8,
    total_platforms: 10,
  },
  platforms: [
    {
      platform: 'douyin',
      daily_volumes: [{ date: '2026-04-10', count: 120 }],
      last_collected_at: new Date(Date.now() - 1800000).toISOString(),
      is_fresh: true,
      has_data: true,
      total_records: 5000,
      scraper_stats: { total: 10, completed: 9, failed: 1, success_rate: 90 },
    },
    {
      platform: 'kuaishou',
      daily_volumes: [],
      last_collected_at: null,
      is_fresh: false,
      has_data: false,
      total_records: 0,
      scraper_stats: { total: 0, completed: 0, failed: 0, success_rate: null },
    },
  ],
  query_days: 7,
  synced_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockCollectionStats),
  }) as unknown as typeof fetch;
});

describe('CollectionDashboardPage', () => {
  it('渲染页面标题"数据采集仪表盘"', () => {
    render(<CollectionDashboardPage />);
    expect(screen.getByText('数据采集仪表盘')).toBeInTheDocument();
  });

  it('初始渲染显示"加载中…"占位', async () => {
    // 让 fetch 永远 pending，确保看到加载态
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));
    render(<CollectionDashboardPage />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });

  it('加载成功后显示抖音平台卡片', async () => {
    await act(async () => { render(<CollectionDashboardPage />); });
    await act(async () => {});
    expect(screen.getByText('抖音')).toBeInTheDocument();
  });

  it('加载成功后显示快手平台卡片', async () => {
    await act(async () => { render(<CollectionDashboardPage />); });
    await act(async () => {});
    expect(screen.getByText('快手')).toBeInTheDocument();
  });

  it('API 失败时显示"加载失败"提示', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));
    await act(async () => { render(<CollectionDashboardPage />); });
    await act(async () => {});
    expect(screen.getByText(/加载失败/)).toBeInTheDocument();
  });

  it('健康时显示流入率', async () => {
    await act(async () => { render(<CollectionDashboardPage />); });
    await act(async () => {});
    expect(screen.getByText(/96\.5%/)).toBeInTheDocument();
  });
});
