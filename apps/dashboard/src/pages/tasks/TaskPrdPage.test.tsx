/**
 * TaskPrdPage tests — A1
 *
 * 验证：
 * 1. 渲染 task title + description（loaded state）
 * 2. 不存在 task id → 显示 not-found 错误
 * 3. 网络错误 → 显示通用错误
 * 4. payload.prd_summary fallback（description 为空时）
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TaskPrdPage from './TaskPrdPage';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'test-task-uuid-1234' }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('TaskPrdPage', () => {
  it('渲染 title 和 description（loaded state）', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'test-task-uuid-1234',
        title: 'Test Task Title',
        status: 'in_progress',
        priority: 'P0',
        task_type: 'dev',
        description: '# PRD\n\nThis is the PRD body content.',
        prd_content: null,
        pr_url: 'https://github.com/foo/bar/pull/123',
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-15T01:00:00Z',
        completed_at: null,
        payload: null,
      }),
    }) as any;

    render(<TaskPrdPage />);

    await waitFor(() => {
      expect(screen.getByText('Test Task Title')).toBeInTheDocument();
    });
    expect(screen.getByText(/This is the PRD body content/)).toBeInTheDocument();
    expect(screen.getByText('in_progress')).toBeInTheDocument();
    expect(screen.getByText('P0')).toBeInTheDocument();
    expect(screen.getByText('View PR ↗')).toBeInTheDocument();
  });

  it('404 → 显示 task not found', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as any;

    render(<TaskPrdPage />);

    await waitFor(() => {
      expect(screen.getByText('Task not found')).toBeInTheDocument();
    });
    expect(screen.getByText(/test-task-uuid-1234/)).toBeInTheDocument();
  });

  it('网络错误 → 显示通用错误', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down'));

    render(<TaskPrdPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load task PRD')).toBeInTheDocument();
    });
    expect(screen.getByText(/Network down/)).toBeInTheDocument();
  });

  it('description 空时 fallback 到 payload.prd_summary', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'test-task-uuid-1234',
        title: 'Fallback Test',
        status: 'queued',
        priority: 'P2',
        task_type: 'dev',
        description: null,
        prd_content: null,
        pr_url: null,
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-15T00:00:00Z',
        completed_at: null,
        payload: { prd_summary: 'Fallback PRD content from payload' },
      }),
    }) as any;

    render(<TaskPrdPage />);

    await waitFor(() => {
      expect(screen.getByText('Fallback Test')).toBeInTheDocument();
    });
    expect(screen.getByText(/Fallback PRD content from payload/)).toBeInTheDocument();
  });
});
