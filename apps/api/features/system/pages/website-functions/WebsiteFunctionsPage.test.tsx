import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import WebsiteFunctionsPage from './WebsiteFunctionsPage';
import snapshot from './inventory.json';

afterEach(cleanup);

describe('网站功能清单', () => {
  it('历史内容业务审计保留，当前清单不再提供已删除内容页面与接口入口', () => {
    expect(snapshot.rows.filter(row => /^(ContentFactory|ContentStudio|ContentTypeConfigPage|PipelineOutputPage):/.test(row['审计编号']))).toHaveLength(15);
    render(<WebsiteFunctionsPage />);
    for (const api of ['/api/brain/pipelines', '/api/brain/topics', '/api/brain/content-types', '/api/brain/analytics/content', '/api/brain/analytics/platform-summary', '/api/brain/analytics/collection-stats']) {
      fireEvent.change(screen.getByLabelText('搜索功能'), { target: { value: api } });
      expect(screen.queryAllByRole('article')).toHaveLength(0);
    }
  });

  it('保留六条旧对话审计快照，但当前视图与搜索不再列出已退役接口', () => {
    expect(snapshot.rows.filter(row => row['后台接口'].startsWith('/api/brain/conversations'))).toHaveLength(6);
    render(<WebsiteFunctionsPage />);
    fireEvent.change(screen.getByLabelText('搜索功能'), { target: { value: '/api/brain/conversations' } });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText(/38 条历史操作已退役/)).toBeVisible();
  });

  it('保留现有指挥页的读取功能，但不再用旧对话名称描述页面', () => {
    render(<WebsiteFunctionsPage />);
    fireEvent.change(screen.getByLabelText('搜索功能'), { target: { value: '/api/brain/warroom/line/:id/command' } });
    const article = screen.getByRole('article');
    expect(within(article).getByText('价值流指挥')).toBeVisible();
    expect(within(article).queryByText('价值流指挥与军师对话')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索功能'), { target: { value: '/api/brain/golden-path/:id' } });
    expect(within(screen.getByRole('article')).getByText('Golden Path 详情')).toBeVisible();
  });
  it('呈现四类说明和独立状态数量，注明盘点日期及可用数下限', () => {
    render(<WebsiteFunctionsPage />);
    expect(screen.getByRole('heading', { name: '网站功能清单' })).toBeVisible();
    for (const category of ['查询', '输入', '变更', '输出']) {
      expect(screen.getByRole('button', { name: category, exact: true })).toBeVisible();
    }
    expect(within(screen.getByRole('region', { name: '全站盘点数量' })).getByText('212')).toBeVisible();
    expect(screen.getByText(/可用数是已验收下限/)).toBeVisible();
    expect(screen.getByText(/^盘点 2026-10-01/)).toBeVisible();
  });

  it('保留原始审计快照，已退役质量页不再进入当前功能搜索', () => {
    expect(snapshot.rows.filter(row => row['审计编号'].startsWith('QualityMonitorPage:'))).toHaveLength(6);
    render(<WebsiteFunctionsPage />);
    fireEvent.change(screen.getByLabelText('搜索功能'), { target: { value: '旧质量运行控制台' } });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText(/38 条历史操作已退役/)).toBeVisible();
  });

  it('已退役模型页的历史回执不计入当前已验收操作', () => {
    render(<WebsiteFunctionsPage />);
    fireEvent.change(screen.getByLabelText('验收状态'), { target: { value: 'verified' } });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('没有符合条件的操作。')).toBeVisible();
  });

  it('存活操作仍可查看原始审计和本人验收状态，不提供执行按钮', () => {
    render(<WebsiteFunctionsPage />);
    fireEvent.change(screen.getByLabelText('搜索功能'), { target: { value: '合并系统报告与作战报告' } });
    const article = screen.getByRole('article');
    fireEvent.click(within(article).getByRole('button', { name: '查看证据' }));
    expect(within(article).getByText(/未找到确认记录/)).toBeVisible();
    expect(within(article).getByRole('link', { name: '原始清单' })).toHaveAttribute('href', expect.stringContaining('app.notion.com'));
    expect(within(article).queryByRole('button', { name: '执行' })).not.toBeInTheDocument();
  });
});
