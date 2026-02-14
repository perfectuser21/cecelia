/**
 * LiveMonitorPage v2 - Basic Tests
 *
 * 基础渲染测试，确保组件正常工作
 * 详细的 UI/UX 验收测试在 DoD 中标记为 manual 测试
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveMonitorPage from './LiveMonitorPage';

// Mock timers for setInterval
vi.useFakeTimers();

describe('LiveMonitorPage v2', () => {
  it('渲染页面标题', () => {
    render(<LiveMonitorPage />);
    expect(screen.getByText('Cecelia Live Monitor')).toBeInTheDocument();
  });

  it('渲染主控区 4 个卡片标题', () => {
    render(<LiveMonitorPage />);
    expect(screen.getByText(/Current Focus/)).toBeInTheDocument();
    expect(screen.getByText(/Next in Queue/)).toBeInTheDocument();
    expect(screen.getByText(/Real-time Metrics/)).toBeInTheDocument();
    expect(screen.getByText(/Live Task Flow/)).toBeInTheDocument();
  });

  it('渲染 3 个 Agent 窗格', () => {
    render(<LiveMonitorPage />);
    expect(screen.getByText(/Caramel/)).toBeInTheDocument();
    expect(screen.getByText(/秋米/)).toBeInTheDocument();
    expect(screen.getByText(/小检/)).toBeInTheDocument();
  });

  it('初始状态显示 mock 数据', () => {
    render(<LiveMonitorPage />);

    // 检查 Current Focus 是否显示
    expect(screen.getByText(/Quality Monitor v2/)).toBeInTheDocument();
    expect(screen.getByText(/cecelia-workspace/)).toBeInTheDocument();
  });

  it('Agent 窗格显示状态标签', () => {
    render(<LiveMonitorPage />);

    // 所有 Agent 初始应该是 Idle
    const idleBadges = screen.getAllByText('Idle');
    expect(idleBadges.length).toBeGreaterThan(0);
  });
});
