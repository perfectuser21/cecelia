/**
 * LiveMonitorPage v14 (Live Monitor v3) - 基础渲染测试
 * 变更：HK VPS + OKR 分层 + Project/Initiative 全宽 + Agents/Queue 并排
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LiveMonitorPage from './LiveMonitorPage';

// Mock fetch
beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  }) as any;
});

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <LiveMonitorPage />
    </MemoryRouter>
  );
}

describe('LiveMonitorPage v14', () => {
  it('渲染顶部栏标识', () => {
    renderWithRouter();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('CECELIA NOC')).toBeInTheDocument();
  });

  it('渲染 OKR 总览和今日快照区块标题', () => {
    renderWithRouter();
    expect(screen.getByText('OKR 总览')).toBeInTheDocument();
    expect(screen.getByText('今日快照')).toBeInTheDocument();
  });

  it('渲染实时 Agents 和等待队列区块', () => {
    renderWithRouter();
    expect(screen.getByText('实时 Agents')).toBeInTheDocument();
    expect(screen.getByText('后台 · Brain 派发')).toBeInTheDocument();
    expect(screen.getByText('等待队列')).toBeInTheDocument();
  });

  it('渲染基础设施指标（US VPS + HK VPS 标签）', () => {
    renderWithRouter();
    expect(screen.getByText('US VPS')).toBeInTheDocument();
    expect(screen.getByText('HK VPS')).toBeInTheDocument();
  });

  it('渲染活跃 Project 区块', () => {
    renderWithRouter();
    expect(screen.getByText('活跃 Project')).toBeInTheDocument();
  });

  it('空状态显示占位文本', () => {
    renderWithRouter();
    expect(screen.getByText(/暂无后台任务/)).toBeInTheDocument();
  });
});
