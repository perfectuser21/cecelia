import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { Activity } from 'lucide-react';
import CollapsibleNavItem from './CollapsibleNavItem';

// 仓库测试环境含 React 18/19 双实例；仅替换路由链接，保留真实导航组件行为。
vi.mock('react-router-dom', () => ({
  Link: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => <a href={to} {...props} />,
}));

const diagnostics = {
  path: '/system', label: '运行与诊断', icon: Activity, featureKey: 'diagnostics',
  children: [
    { path: '/system', label: '运行健康', icon: Activity, featureKey: 'health', exact: true },
    { path: '/system/cecelia', label: '执行概览', icon: Activity, featureKey: 'execution' },
  ],
};

const resources = {
  path: '/machines', label: '机器资源', icon: Activity, featureKey: 'resources',
  children: [
    { path: '/machines', label: '设备清单', icon: Activity, featureKey: 'machines' },
    { path: '/system/infra', label: '资源监控', icon: Activity, featureKey: 'infra' },
    { path: '/system/claude', label: '会话管理', icon: Activity, featureKey: 'sessions' },
  ],
};

function renderNavigation(currentPath: string, collapsed = false) {
  return render(
    <>
      {[resources, diagnostics].map(item => (
        <CollapsibleNavItem key={item.path} item={item} collapsed={collapsed} isCore currentPath={currentPath} onExpandSidebar={vi.fn()} />
      ))}
    </>
  );
}

describe('可折叠主导航路径归类', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['/system/team', '/system/infra', '/system/claude'])('%s 不激活诊断总览或展开诊断分类', path => {
    renderNavigation(path);
    expect(screen.getByRole('link', { name: '运行健康' })).not.toHaveClass('bg-slate-600/25');
    expect(screen.getByRole('button', { name: /运行与诊断/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('执行详情只高亮执行概览，诊断总览不重复高亮', () => {
    renderNavigation('/system/cecelia/runs/run-1');
    expect(screen.getByRole('link', { name: '执行概览' })).toHaveClass('bg-slate-600/25');
    expect(screen.getByRole('link', { name: '运行健康' })).not.toHaveClass('bg-slate-600/25');
    expect(screen.getByRole('button', { name: /运行与诊断/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('设备详情仍归机器资源分类', () => {
    renderNavigation('/machines/us-vps');
    expect(screen.getByRole('link', { name: '设备清单' })).toHaveClass('bg-slate-600/25');
    expect(screen.getByRole('button', { name: /机器资源/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('总览自身仍可激活并支持折叠', () => {
    renderNavigation('/system');
    expect(screen.getByRole('link', { name: '运行健康' })).toHaveClass('bg-slate-600/25');
    const toggle = screen.getByRole('button', { name: /运行与诊断/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('侧栏收起时只高亮当前路径所属分类', () => {
    renderNavigation('/system/infra', true);
    expect(screen.getByRole('button', { name: '机器资源' })).toHaveClass('bg-slate-600/30');
    expect(screen.getByRole('button', { name: '运行与诊断' })).not.toHaveClass('bg-slate-600/30');
  });
});
