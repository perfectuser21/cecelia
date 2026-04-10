/**
 * TaskTypeConfigPage — 任务类型配置页集成测试
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
  it('渲染页面标题"任务类型配置"', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    expect(screen.getByText('任务类型配置')).toBeInTheDocument();
  });

  it('渲染四个分类标签 A/B/C/D', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    expect(screen.getByText('A类')).toBeInTheDocument();
    expect(screen.getByText('B类')).toBeInTheDocument();
    expect(screen.getByText('C类')).toBeInTheDocument();
    expect(screen.getByText('D类')).toBeInTheDocument();
  });

  it('A类卡片显示"锁机器 + 锁模型"标签', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    expect(screen.getByText('锁机器 + 锁模型')).toBeInTheDocument();
  });

  it('C类卡片显示"锁模型（Codex），不锁机器"标签', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    expect(screen.getByText('锁模型（Codex），不锁机器')).toBeInTheDocument();
  });

  it('点击 A类 展开 A 类任务列表', async () => {
    await act(async () => { render(<TaskTypeConfigPage />); });
    const aCard = screen.getByText('A类');
    fireEvent.click(aCard);
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
