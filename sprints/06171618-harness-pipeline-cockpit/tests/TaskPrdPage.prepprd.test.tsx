/**
 * TaskPrdPage — PrepPRD 全文渲染测试（Harness Cockpit Phase 1）
 *
 * TDD Red：当前 TaskPrdPage 用 <pre> 渲染，pickPrdContent 不读 payload.prep_prd_body。
 * 这些用例在实现前应失败，实现后转绿。
 *
 * 覆盖 Golden Path：
 *  - Step 2: pickPrdContent 优先读 payload.prep_prd_body（旧字段被忽略）
 *  - Step 3: Markdown 渲染为真实 DOM（h1/ul/table），非 <pre> 纯文本
 *  - 边界 1: prep_prd_body 为空 → 退回旧字段
 *  - 回归守卫: 404 / 网络错误态不回归
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TaskPrdPage from './TaskPrdPage';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'prepprd-task-uuid' }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const PREP_PRD = [
  '# Golden Path',
  '',
  '用户打开 PRD 页 → 看到完整 PrepPRD 全文',
  '',
  '## 前置',
  '',
  '- 前置条件一',
  '- 前置条件二',
  '',
  '## 验收',
  '',
  '| 项 | 期望 |',
  '| --- | --- |',
  '| 渲染 | Markdown |',
].join('\n');

function mockTask(overrides: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 'prepprd-task-uuid',
      title: 'PrepPRD Task',
      status: 'in_progress',
      priority: 'P1',
      task_type: 'harness_contract_propose',
      description: null,
      prd_content: null,
      pr_url: null,
      created_at: '2026-06-17T00:00:00Z',
      updated_at: '2026-06-17T00:00:00Z',
      completed_at: null,
      payload: null,
      ...overrides,
    }),
  }) as any;
}

describe('TaskPrdPage — PrepPRD 全文渲染', () => {
  it('页面加载渲染主体不报错', async () => {
    mockTask({ payload: { prep_prd_body: PREP_PRD } });
    render(<TaskPrdPage />);
    await waitFor(() => {
      expect(screen.getByText('PrepPRD Task')).toBeInTheDocument();
    });
    // PRD 主体容器存在（实现需加 data-testid="prd-content"）
    expect(document.querySelector('[data-testid="prd-content"]')).not.toBeNull();
  });

  it('prep_prd_body 优先于旧字段', async () => {
    mockTask({
      description: 'OLD-description',
      payload: { prep_prd_body: PREP_PRD, prd_summary: 'OLD-summary' },
    });
    render(<TaskPrdPage />);
    await waitFor(() => {
      expect(screen.getByText('PrepPRD Task')).toBeInTheDocument();
    });
    // 显示 prep_prd_body 全文片段
    expect(
      screen.getByText(/用户打开 PRD 页 → 看到完整 PrepPRD 全文/)
    ).toBeInTheDocument();
    // 旧字段内容不出现
    expect(screen.queryByText('OLD-description')).toBeNull();
    expect(screen.queryByText('OLD-summary')).toBeNull();
  });

  it('Markdown 渲染为真实 DOM 元素', async () => {
    mockTask({ payload: { prep_prd_body: PREP_PRD } });
    render(<TaskPrdPage />);
    await waitFor(() => {
      expect(screen.getByText('PrepPRD Task')).toBeInTheDocument();
    });
    // # Golden Path 渲染成 <h1>，文字为「Golden Path」而非字面「# Golden Path」
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Golden Path');
    expect(screen.queryByText('# Golden Path')).toBeNull();
    // PRD 主体不再用 <pre> 包裹原始 Markdown
    const pre = document.querySelector('[data-testid="prd-content"] pre');
    if (pre) {
      expect(pre.textContent || '').not.toContain('# Golden Path');
    }
  });

  it('表格与列表按 Markdown 渲染', async () => {
    mockTask({ payload: { prep_prd_body: PREP_PRD } });
    render(<TaskPrdPage />);
    await waitFor(() => {
      expect(screen.getByText('PrepPRD Task')).toBeInTheDocument();
    });
    expect(screen.getByRole('table')).toBeInTheDocument();
    const lists = screen.getAllByRole('list');
    expect(lists.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('前置条件一')).toBeInTheDocument();
  });

  it('prep_prd_body 为空时退回旧字段', async () => {
    mockTask({
      description: null,
      prd_content: null,
      payload: { prd_summary: 'fallback 内容 from summary' },
    });
    render(<TaskPrdPage />);
    await waitFor(() => {
      expect(screen.getByText('PrepPRD Task')).toBeInTheDocument();
    });
    expect(screen.getByText(/fallback 内容 from summary/)).toBeInTheDocument();
  });

  it('404 与网络错误态不回归', async () => {
    // 404
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as any;
    const { unmount } = render(<TaskPrdPage />);
    await waitFor(() => {
      expect(screen.getByText('Task not found')).toBeInTheDocument();
    });
    unmount();

    // 网络错误
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down'));
    render(<TaskPrdPage />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load task PRD')).toBeInTheDocument();
    });
  });
});
