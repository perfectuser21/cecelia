/**
 * LiveMonitorPage v19 (Live Monitor v3.6) - 基础渲染测试
 * 变更：新增 DEV STEPS 面板（DevStepPanel），展示 /dev 任务步骤进度
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import LiveMonitorPage from './LiveMonitorPage';

// Mock react-router-dom 避免 React 18/19 双实例冲突
// （monorepo 中 apps/api 依赖 React 19 导致 root node_modules/react 为 v19，
//   而 react-router 在 root 会加载 React 19，但 react-dom 在 dashboard 本地为 React 18）
vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: any) => children,
  useNavigate: () => vi.fn(),
}));

// Mock recharts 避免 CI 环境 happy-dom 中 SVG/ResizeObserver 兼容问题
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'line-chart' }, children),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'responsive-container' }, children),
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

describe('LiveMonitorPage v19', () => {
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

  it('DevStepPanel: 渲染 DEV STEPS 区块标签', () => {
    renderWithRouter();
    expect(screen.getByText('DEV STEPS')).toBeInTheDocument();
  });

  it('DevStepPanel: 无 /dev 任务时显示空状态', () => {
    // fetch 默认返回空 {} / []，activeTasks 为空
    renderWithRouter();
    expect(screen.getByText('无运行中的 /dev 任务')).toBeInTheDocument();
  });

  it('DevStepPanel: 有 dev 任务时显示步骤编号和标题', async () => {
    const devTask = {
      id: 'test-task-1',
      title: '测试开发任务',
      priority: 'P1',
      status: 'in_progress',
      project_id: null,
      created_at: '2026-03-15T00:00:00Z',
      task_type: 'dev',
      custom_props: { dev_step: 2, dev_step_name: 'Code' },
    };

    // 设置 fetch 在渲染前
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('status=in_progress')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([devTask]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    await act(async () => {
      renderWithRouter();
    });
    // act flush promises + state updates
    await act(async () => {});

    // 步骤编号 S2 应显示
    expect(screen.getByText('S2')).toBeInTheDocument();
    // 步骤名 Code 应显示
    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('DevStepPanel: dev 任务无 custom_props 时显示"步骤未知"', async () => {
    const devTask = {
      id: 'test-task-2',
      title: '无步骤信息任务',
      priority: 'P0',
      status: 'in_progress',
      project_id: null,
      created_at: '2026-03-15T00:00:00Z',
      task_type: 'dev',
      custom_props: {},
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('status=in_progress')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([devTask]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    await act(async () => {
      renderWithRouter();
    });
    await act(async () => {});

    expect(screen.getByText('步骤未知')).toBeInTheDocument();
  });

  it('DevStepPanel: 非 dev 类型任务不显示在 DEV STEPS 面板', async () => {
    const nonDevTask = {
      id: 'test-task-3',
      title: '非dev任务',
      priority: 'P1',
      status: 'in_progress',
      project_id: null,
      created_at: '2026-03-15T00:00:00Z',
      task_type: 'other',
      custom_props: { dev_step: 1 },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('status=in_progress')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([nonDevTask]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    await act(async () => {
      renderWithRouter();
    });
    await act(async () => {});

    // 非 dev 任务过滤后，面板显示空状态
    expect(screen.getByText('无运行中的 /dev 任务')).toBeInTheDocument();
  });
});
