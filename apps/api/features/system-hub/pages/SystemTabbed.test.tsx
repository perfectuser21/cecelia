import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SystemTabbed from './SystemTabbed';

// 隔离各页数据请求，保留真实页签选择与懒加载行为。
vi.mock('../../system/pages/OpsDashboard', () => ({ default: () => <div>health-page</div> }));
vi.mock('../../execution/pages/CeceliaOverview', () => ({ default: () => <div>execution-page</div> }));
vi.mock('./SystemAutomationTab', () => ({ default: () => <div>automation-page</div> }));
vi.mock('./AlarmLedgerTab', () => ({ default: () => <div>alarms-page</div> }));
vi.mock('../../system/pages/InfrastructureMonitor', () => ({ default: () => <div>infra-page</div> }));
vi.mock('../../system/pages/ClaudeMonitor', () => ({ default: () => <div>sessions-page</div> }));
vi.mock('./SystemEngineTab', () => ({ default: () => <div>engine-page</div> }));
vi.mock('../../system/pages/FeatureMap', () => ({ default: () => <div>architecture-page</div> }));
vi.mock('../../system/pages/TeamPage', () => ({ default: () => <div>team-page</div> }));

describe('系统管理页签保留深链接', () => {
  it.each([
    ['/system', '运行健康', 'health-page'],
    ['/system/cecelia', '执行概览', 'execution-page'],
    ['/system/automation', '自动化运行', 'automation-page'],
    ['/system/alarms', '闹钟总账', 'alarms-page'],
    ['/system/infra', '资源监控', 'infra-page'],
    ['/system/claude', '会话管理', 'sessions-page'],
    ['/system/engine', '开发引擎', 'engine-page'],
    ['/system/feature-map', '架构图', 'architecture-page'],
    ['/system/team', '员工配置', 'team-page'],
  ])('%s 仍选中对应中文页签并加载原页面', async (path, label, page) => {
    render(<MemoryRouter initialEntries={[path]}><SystemTabbed /></MemoryRouter>);
    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(9);
    const activeTab = screen.getAllByRole('button').find(button => button.classList.contains('bg-slate-700'));
    expect(activeTab).toHaveTextContent(label);
  });
});
