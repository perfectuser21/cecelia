/**
 * LiveMonitorPage v18 (Live Monitor v3.4) - 基础渲染测试
 * 变更：去 emoji + INFRA 合并块 + BRAIN 块 + 2列 Project + 全 Area 显示
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LiveMonitorPage from './LiveMonitorPage';

// Mock react-router-dom 避免 React 18/19 双实例冲突
// （monorepo 中 apps/api 依赖 React 19 导致 root node_modules/react 为 v19，
//   而 react-router 在 root 会加载 React 19，但 react-dom 在 dashboard 本地为 React 18）
vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: any) => children,
  useNavigate: () => vi.fn(),
}));

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

describe('LiveMonitorPage v18', () => {
  it('渲染顶部栏标识（无 CECELIA NOC）', () => {
    renderWithRouter();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByText('CECELIA NOC')).not.toBeInTheDocument();
  });

  it('渲染 OKR 总览和 Projects 区块标题', () => {
    renderWithRouter();
    expect(screen.getByText('OKR 总览')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('渲染左栏 INFRA 合并区块（US + HK）', () => {
    renderWithRouter();
    expect(screen.getByText('INFRA')).toBeInTheDocument();
    expect(screen.getByText('US')).toBeInTheDocument();
    expect(screen.getByText('HK')).toBeInTheDocument();
  });

  it('渲染左栏 BRAIN 区块', () => {
    renderWithRouter();
    expect(screen.getByText('BRAIN')).toBeInTheDocument();
  });

  it('渲染左栏 ACC 账号区块', () => {
    renderWithRouter();
    expect(screen.getByText('ACC')).toBeInTheDocument();
  });

  it('渲染左栏 AGENTS 区块', () => {
    renderWithRouter();
    expect(screen.getByText('AGENTS')).toBeInTheDocument();
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
