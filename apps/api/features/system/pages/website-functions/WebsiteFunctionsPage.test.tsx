import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import WebsiteFunctionsPage from './WebsiteFunctionsPage';

afterEach(cleanup);

describe('网站功能清单', () => {
  it('呈现四类说明和独立状态数量，注明盘点日期及可用数下限', () => {
    render(<WebsiteFunctionsPage />);
    expect(screen.getByRole('heading', { name: '网站功能清单' })).toBeVisible();
    for (const category of ['查询', '输入', '变更', '输出']) {
      expect(screen.getByRole('button', { name: category, exact: true })).toBeVisible();
    }
    expect(screen.getByText('249')).toBeVisible();
    expect(screen.getByText(/可用数是已验收下限/)).toBeVisible();
    expect(screen.getByText(/^盘点 2026-10-01/)).toBeVisible();
    expect(screen.getByText(/配置变更闭环增加 1 项/)).toBeVisible();
  });

  it('已验收筛选只返回有证据的条目，搜索和分类继续缩小结果', () => {
    render(<WebsiteFunctionsPage />);
    fireEvent.change(screen.getByLabelText('验收状态'), { target: { value: 'verified' } });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '变更', exact: true }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '保存单Agent模型' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('搜索功能'), { target: { value: '不存在的功能' } });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('没有符合条件的操作。')).toBeVisible();
  });

  it('可查看单项真实证据、原始审计和本人验收状态，不提供执行按钮', () => {
    render(<WebsiteFunctionsPage />);
    fireEvent.change(screen.getByLabelText('搜索功能'), { target: { value: '保存单Agent模型' } });
    const article = screen.getByRole('article');
    fireEvent.click(within(article).getByRole('button', { name: '查看证据' }));
    expect(within(article).getByText(/2954031/)).toBeVisible();
    expect(within(article).getByText(/未找到确认记录/)).toBeVisible();
    expect(within(article).getByRole('link', { name: '原始清单' })).toHaveAttribute('href', expect.stringContaining('app.notion.com'));
    expect(within(article).queryByRole('button', { name: '执行' })).not.toBeInTheDocument();
  });
});
