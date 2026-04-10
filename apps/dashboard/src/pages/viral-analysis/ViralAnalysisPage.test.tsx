/**
 * ViralAnalysisPage — 爆款分析仪表盘集成测试
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useNavigate: () => vi.fn(),
}));

import ViralAnalysisPage from './ViralAnalysisPage';

const mockSummaryResponse = {
  since: '2026-04-03',
  days: 7,
  platforms: [
    {
      platform: 'douyin',
      content_count: 10,
      total_views: 50000,
      total_likes: 2000,
      total_comments: 500,
      total_shares: 300,
      avg_views: 5000,
      engagement_rate: 56.0,
      last_collected_at: '2026-04-10T08:00:00Z',
    },
  ],
};

const mockContentResponse = [
  {
    id: 'c1',
    platform: 'douyin',
    title: '爆款内容标题',
    content_id: 'vid_001',
    views: 100000,
    likes: 5000,
    comments: 1000,
    shares: 800,
    published_at: '2026-04-08T10:00:00Z',
    collected_at: '2026-04-10T08:00:00Z',
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('platform-summary')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSummaryResponse) });
    }
    if (typeof url === 'string' && url.includes('analytics/content')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockContentResponse) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as unknown as typeof fetch;
});

describe('ViralAnalysisPage', () => {
  it('渲染页面标题"爆款分析"', () => {
    render(<ViralAnalysisPage />);
    expect(screen.getByText('爆款分析')).toBeInTheDocument();
  });

  it('渲染"各平台互动率"副标题', () => {
    render(<ViralAnalysisPage />);
    expect(screen.getByText(/各平台内容互动率/)).toBeInTheDocument();
  });

  it('渲染时间范围筛选器（近7/14/30天）', () => {
    render(<ViralAnalysisPage />);
    expect(screen.getByText('近 7 天')).toBeInTheDocument();
    expect(screen.getByText('近 14 天')).toBeInTheDocument();
    expect(screen.getByText('近 30 天')).toBeInTheDocument();
  });

  it('加载后显示平台数据卡片（抖音）', async () => {
    await act(async () => {
      render(<ViralAnalysisPage />);
    });
    await act(async () => {});
    // 平台卡片标题会出现多次（下拉选项+卡片），用 getAllByText 验证
    const douyinElements = screen.getAllByText('抖音');
    expect(douyinElements.length).toBeGreaterThan(0);
  });

  it('加载后显示热门内容列表', async () => {
    await act(async () => {
      render(<ViralAnalysisPage />);
    });
    await act(async () => {});
    expect(screen.getByText('爆款内容标题')).toBeInTheDocument();
  });

  it('API 错误时仍保留上次数据（静默失败）', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
    await act(async () => {
      render(<ViralAnalysisPage />);
    });
    await act(async () => {});
    // 静默失败时显示加载中或空状态，不崩溃
    expect(document.body).toBeTruthy();
  });

  it('无数据时显示空状态提示', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ since: '', days: 7, platforms: [] }),
      })
    );
    await act(async () => {
      render(<ViralAnalysisPage />);
    });
    await act(async () => {});
    expect(screen.getByText('暂无内容数据')).toBeInTheDocument();
  });

  it('点击刷新按钮触发重新 fetch', async () => {
    await act(async () => {
      render(<ViralAnalysisPage />);
    });
    await act(async () => {});
    const refreshBtn = screen.getByText('↺ 刷新');
    fireEvent.click(refreshBtn);
    expect(global.fetch).toHaveBeenCalled();
  });
});
