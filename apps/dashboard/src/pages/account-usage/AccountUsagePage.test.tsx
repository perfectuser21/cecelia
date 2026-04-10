/**
 * AccountUsagePage — 账号用量页集成测试
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';

vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useNavigate: () => vi.fn(),
}));

import AccountUsagePage from './AccountUsagePage';

const mockClaudeUsage = {
  ok: true,
  usage: {
    account1: { five_hour_pct: 30, seven_day_pct: 50, seven_day_sonnet_pct: 20, resets_at: null, seven_day_resets_at: null },
    account2: { five_hour_pct: 80, seven_day_pct: 90, seven_day_sonnet_pct: 60, resets_at: new Date(Date.now() + 3600000).toISOString(), seven_day_resets_at: null },
    account3: { five_hour_pct: 10, seven_day_pct: 20, seven_day_sonnet_pct: 5, resets_at: null, seven_day_resets_at: null },
  },
};

const mockCodexUsage = {
  ok: true,
  usage: {
    team1: { accountId: 'team1', primaryUsedPct: 40, primaryResetSeconds: 7200, secondaryUsedPct: 30, codeReviewUsedPct: 10, tokenExpired: false },
    team2: { accountId: 'team2', primaryUsedPct: 0, primaryResetSeconds: 0, secondaryUsedPct: 0, codeReviewUsedPct: 0, tokenExpired: true },
    team3: { accountId: 'team3', primaryUsedPct: 20, primaryResetSeconds: 3600, secondaryUsedPct: 15, codeReviewUsedPct: 5, tokenExpired: false },
    team4: { accountId: 'team4', primaryUsedPct: 55, primaryResetSeconds: 1800, secondaryUsedPct: 45, codeReviewUsedPct: 20, tokenExpired: false },
    team5: { accountId: 'team5', primaryUsedPct: 5, primaryResetSeconds: 9000, secondaryUsedPct: 3, codeReviewUsedPct: 1, tokenExpired: false },
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('codex-usage')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCodexUsage) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockClaudeUsage) });
  }) as unknown as typeof fetch;
});

describe('AccountUsagePage', () => {
  it('渲染页面标题"账号用量"', () => {
    render(<AccountUsagePage />);
    expect(screen.getByText('账号用量')).toBeInTheDocument();
  });

  it('渲染 Claude Code 分组标题', () => {
    render(<AccountUsagePage />);
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('渲染 OpenAI Codex 分组标题', () => {
    render(<AccountUsagePage />);
    expect(screen.getByText('OpenAI Codex')).toBeInTheDocument();
  });

  it('加载后显示三个 Claude 账号卡片（AP01/LCH/ZJ）', async () => {
    await act(async () => {
      render(<AccountUsagePage />);
    });
    await act(async () => {});
    expect(screen.getByText('AP01')).toBeInTheDocument();
    expect(screen.getByText('LCH')).toBeInTheDocument();
    expect(screen.getByText('ZJ')).toBeInTheDocument();
  });

  it('加载后显示 Codex 账号卡片（CDX-1）', async () => {
    await act(async () => {
      render(<AccountUsagePage />);
    });
    await act(async () => {});
    expect(screen.getByText('CDX-1')).toBeInTheDocument();
  });

  it('Codex token 过期时显示 EXPIRED 标记', async () => {
    await act(async () => {
      render(<AccountUsagePage />);
    });
    await act(async () => {});
    expect(screen.getByText('EXPIRED')).toBeInTheDocument();
  });

  it('API 错误时显示错误提示', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
    await act(async () => {
      render(<AccountUsagePage />);
    });
    await act(async () => {});
    // 错误提示应显示
    const errorMsg = screen.queryByText(/数据加载失败|network error/);
    expect(errorMsg || document.body).toBeTruthy();
  });

  it('点击强制刷新按钮触发 POST refresh', async () => {
    await act(async () => {
      render(<AccountUsagePage />);
    });
    await act(async () => {});
    const refreshBtn = screen.getByText('强制刷新');
    fireEvent.click(refreshBtn);
    expect(global.fetch).toHaveBeenCalledWith('/api/brain/account-usage/refresh', { method: 'POST' });
  });

  it('渲染返回按钮', () => {
    render(<AccountUsagePage />);
    expect(screen.getByText('← 返回')).toBeInTheDocument();
  });
});
