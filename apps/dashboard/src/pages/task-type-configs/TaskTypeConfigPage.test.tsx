/**
 * TaskTypeConfigPage — 任务路由配置页集成测试
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';

vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useNavigate: () => vi.fn(),
}));

import TaskTypeConfigPage from './TaskTypeConfigPage';

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
  }) as unknown as typeof fetch;
});

describe('TaskTypeConfigPage', () => {
  it('渲染页面标题"任务路由配置"', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    await act(async () => {});
    expect(screen.getByText('任务路由配置')).toBeInTheDocument();
  });

  it('渲染四个分类按钮（A/B/C/D 字母圆圈）', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    await act(async () => {});
    // CategoryCard 渲染字母，不是"A类"
    const aBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('A') && b.textContent?.includes('锁机器'));
    expect(aBtn).toBeTruthy();
  });

  it('渲染 A 类标签"锁机器 + 锁模型"', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    await act(async () => {});
    expect(screen.getByText('锁机器 + 锁模型')).toBeInTheDocument();
  });

  it('渲染 C 类标签"锁模型（Codex），不锁机器"', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    await act(async () => {});
    expect(screen.getByText('锁模型（Codex），不锁机器')).toBeInTheDocument();
  });

  it('点击"锁机器 + 锁模型"展开 A 类任务列表', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    await act(async () => {});
    const aCard = screen.getByText('锁机器 + 锁模型').closest('button');
    if (aCard) fireEvent.click(aCard);
    await act(async () => {});
    // A类只有 dev 任务
    expect(screen.getByText('dev')).toBeInTheDocument();
  });

  it('页面加载时调用 task-type-configs API', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    await act(async () => {});
    expect(global.fetch).toHaveBeenCalledWith('/api/cecelia/task-type-configs');
  });
});
