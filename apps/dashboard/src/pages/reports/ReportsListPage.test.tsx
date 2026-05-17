/**
 * ReportsListPage — 系统简报列表页集成测试
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';

vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useNavigate: () => vi.fn(),
}));

import ReportsListPage from './ReportsListPage';

const mockReportsResponse = {
  reports: [
    {
      id: 'rpt-001',
      type: '48h_system_report',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      title: '48h 系统简报测试标题',
      summary: '系统运行正常',
      metadata: { triggered_by: 'auto' },
    },
    {
      id: 'rpt-002',
      type: 'weekly_report',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      title: null,
      summary: null,
      metadata: {},
    },
  ],
  count: 2,
  total: 2,
  limit: 20,
  offset: 0,
};

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockReportsResponse),
  }) as unknown as typeof fetch;
});

describe('ReportsListPage', () => {
  it('渲染页面标题"系统简报"', async () => {
    await act(async () => { render(<ReportsListPage />); });
    expect(screen.getByText('系统简报')).toBeInTheDocument();
  });

  it('渲染副标题文案', async () => {
    await act(async () => { render(<ReportsListPage />); });
    expect(screen.getByText(/系统简报.*48h.*内容周报/)).toBeInTheDocument();
  });

  it('加载后显示简报标题', async () => {
    await act(async () => { render(<ReportsListPage />); });
    await act(async () => {});
    expect(screen.getByText('48h 系统简报测试标题')).toBeInTheDocument();
  });

  it('无标题简报显示 ID 前缀', async () => {
    await act(async () => { render(<ReportsListPage />); });
    await act(async () => {});
    // rpt-002 无 title，显示 "简报 #rpt-002" 前8位
    expect(screen.getByText(/简报 #rpt-002/)).toBeInTheDocument();
  });

  it('空列表时显示暂无简报提示', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ reports: [], count: 0, total: 0, limit: 20, offset: 0 }),
    });
    await act(async () => { render(<ReportsListPage />); });
    await act(async () => {});
    expect(screen.getByText('暂无简报记录')).toBeInTheDocument();
  });

  it('API 失败时显示加载失败提示', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 500 });
    await act(async () => { render(<ReportsListPage />); });
    await act(async () => {});
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
  });

  it('点击"手动生成"按钮触发 POST 请求', async () => {
    await act(async () => { render(<ReportsListPage />); });
    await act(async () => {});
    const generateBtn = screen.getByText('手动生成');
    fireEvent.click(generateBtn);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/brain/reports'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
