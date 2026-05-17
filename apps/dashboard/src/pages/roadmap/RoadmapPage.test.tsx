/**
 * RoadmapPage 基础渲染测试
 * 验证 OKR Roadmap 页面三列布局、SelfDrive 面板、Agent 活动面板
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import RoadmapPage from './RoadmapPage';

// Mock react-router-dom（避免双实例冲突）
vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: any) => children,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/okr-roadmap' }),
}));

// Mock fetch（默认返回空数据）
beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
  }) as any;
});

describe('RoadmapPage', () => {
  it('渲染页面标题 OKR Roadmap', async () => {
    await act(async () => {
      render(<RoadmapPage />);
    });
    expect(screen.getByText('OKR Roadmap')).toBeInTheDocument();
  });

  it('渲染三列标题 Now / Next / Later', async () => {
    await act(async () => {
      render(<RoadmapPage />);
    });
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
    expect(screen.getByText('Later')).toBeInTheDocument();
  });

  it('渲染 SelfDrive 思考面板标题', async () => {
    await act(async () => {
      render(<RoadmapPage />);
    });
    expect(screen.getByText('SelfDrive 思考')).toBeInTheDocument();
  });

  it('渲染 Agent 活动面板标题', async () => {
    await act(async () => {
      render(<RoadmapPage />);
    });
    expect(screen.getByText('Agent 活动')).toBeInTheDocument();
  });

  it('无数据时三列显示空状态提示', async () => {
    await act(async () => {
      render(<RoadmapPage />);
    });
    await act(async () => {});
    expect(screen.getByText('暂无进行中项目')).toBeInTheDocument();
    expect(screen.getByText('暂无 KR 关联项目')).toBeInTheDocument();
    expect(screen.getByText('暂无待规划项目')).toBeInTheDocument();
  });

  it('无 Agent 时显示空状态提示', async () => {
    await act(async () => {
      render(<RoadmapPage />);
    });
    await act(async () => {});
    expect(screen.getByText('暂无 Agent 在运行')).toBeInTheDocument();
  });

  it('无 SelfDrive 数据时显示空状态提示', async () => {
    await act(async () => {
      render(<RoadmapPage />);
    });
    await act(async () => {});
    expect(screen.getByText('暂无 Brain 活动记录')).toBeInTheDocument();
  });

  it('有 in_progress 项目时显示在 Now 列', async () => {
    const mockProjects = [
      {
        id: 'proj-1',
        name: '测试进行中项目',
        status: 'in_progress',
        kr_id: null,
        goal_id: null,
        deadline: null,
        type: 'initiative',
        parent_id: null,
        created_at: '2026-03-01T00:00:00Z',
      },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/brain/projects')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProjects) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    await act(async () => {
      render(<RoadmapPage />);
    });
    await act(async () => {});

    expect(screen.getByText('测试进行中项目')).toBeInTheDocument();
  });

  it('有 in_progress 的 Brain task 时显示 Agent 活动', async () => {
    const mockTasks = [
      {
        id: 'task-1',
        title: '[P1] 测试 Agent 任务',
        priority: 'P1',
        status: 'in_progress',
        task_type: 'dev',
        custom_props: { dev_step: 3, dev_step_name: 'Integrate' },
      },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('status=in_progress')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTasks) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    await act(async () => {
      render(<RoadmapPage />);
    });
    await act(async () => {});

    expect(screen.getByText('[P1] 测试 Agent 任务')).toBeInTheDocument();
  });

  it('KR 进度条显示（有 kr_id 关联时）', async () => {
    const mockGoals = [
      { id: 'goal-1', title: '测试 KR', type: 'area_okr', progress: 65, status: 'pending', priority: 'P1', parent_id: null, area_id: null },
    ];
    const mockProjects = [
      { id: 'proj-2', name: 'KR 关联项目', status: 'pending', kr_id: 'goal-1', goal_id: null, deadline: null, type: 'initiative', parent_id: null, created_at: '2026-03-01T00:00:00Z' },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/brain/goals')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGoals) });
      }
      if (typeof url === 'string' && url.includes('/api/brain/projects')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProjects) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    await act(async () => {
      render(<RoadmapPage />);
    });
    await act(async () => {});

    expect(screen.getByText('KR 关联项目')).toBeInTheDocument();
    expect(screen.getByText('测试 KR')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
  });
});
