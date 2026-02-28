/**
 * LiveMonitorPage v17 (Live Monitor v3.3) - 基础渲染测试
 * 变更：左栏基础设施(donut/rings/circles) + OKR Global→Area层级 + Projects by Area
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

describe('LiveMonitorPage v17', () => {
  it('渲染顶部栏标识', () => {
    renderWithRouter();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('CECELIA NOC')).toBeInTheDocument();
  });

  it('渲染 OKR 总览和 Projects 区块标题', () => {
    renderWithRouter();
    expect(screen.getByText('OKR 总览')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('渲染左栏 Agents 紧凑圆点区块', () => {
    renderWithRouter();
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });

  it('渲染基础设施指标（US VPS + HK VPS 标签）', () => {
    renderWithRouter();
    expect(screen.getByText('US VPS')).toBeInTheDocument();
    expect(screen.getByText('HK VPS')).toBeInTheDocument();
  });

  it('Projects 区块显示空状态', () => {
    renderWithRouter();
    expect(screen.getByText('暂无活跃项目')).toBeInTheDocument();
  });

  it('无 Agent 时显示空闲状态', () => {
    renderWithRouter();
    expect(screen.getByText('空闲')).toBeInTheDocument();
  });

  it('无 global_okr 时显示"全局目标未设置"占位', () => {
    renderWithRouter();
    expect(screen.getByText('全局目标未设置')).toBeInTheDocument();
  });
});
