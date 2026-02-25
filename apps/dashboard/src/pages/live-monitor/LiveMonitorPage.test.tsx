/**
 * LiveMonitorPage v13 - 基础渲染测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveMonitorPage from './LiveMonitorPage';

// Mock fetch
beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  }) as any;
});

describe('LiveMonitorPage v13', () => {
  it('渲染顶部栏标识', () => {
    render(<LiveMonitorPage />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('CECELIA NOC')).toBeInTheDocument();
  });

  it('渲染 OKR 和快照区块标题', () => {
    render(<LiveMonitorPage />);
    expect(screen.getByText('当前 OKR')).toBeInTheDocument();
    expect(screen.getByText('今日快照')).toBeInTheDocument();
  });

  it('渲染实时 Agents 区块', () => {
    render(<LiveMonitorPage />);
    expect(screen.getByText('实时 Agents')).toBeInTheDocument();
    expect(screen.getByText('前台 · 交互式')).toBeInTheDocument();
    expect(screen.getByText('后台 · Brain 派发')).toBeInTheDocument();
  });

  it('渲染基础设施区块', () => {
    render(<LiveMonitorPage />);
    expect(screen.getByText('基础设施')).toBeInTheDocument();
  });

  it('空状态显示占位文本', () => {
    render(<LiveMonitorPage />);
    expect(screen.getByText('暂无前台会话')).toBeInTheDocument();
    expect(screen.getByText('暂无后台任务')).toBeInTheDocument();
  });
});
