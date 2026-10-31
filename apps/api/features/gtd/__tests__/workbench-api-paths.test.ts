import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuickCapture from '../components/QuickCapture';
import GTDInbox from '../pages/GTDInbox';
import GTDTasks from '../pages/GTDTasks';

const id = '11111111-1111-4111-8111-111111111111';
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('真实GTD页面使用canonical API并消费回执', () => {
  it('快速记录提交实际POST与内容，显示服务返回的记录编号', async () => {
    const fetch = vi.fn(async () => response({ id, status: 'pending' }));
    vi.stubGlobal('fetch', fetch);
    render(React.createElement(QuickCapture));
    fireEvent.change(screen.getByRole('textbox', { name: '记录内容' }), { target: { value: '  待整理的想法  ' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(await screen.findByRole('status')).toHaveTextContent(id);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/brain/captures');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toMatchObject({ content: '待整理的想法', source: 'dashboard' });
    expect(JSON.parse(options.body as string).dedupe_key).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('记录请求失败时保留文字并显示可见错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, false)));
    render(React.createElement(QuickCapture));
    fireEvent.change(screen.getByRole('textbox', { name: '记录内容' }), { target: { value: '不能丢失的文字' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('记录保存失败');
    expect(screen.getByRole('textbox')).toHaveValue('不能丢失的文字');
  });

  it('收件历史从captures读取并展示真实响应，项目来源使用canonical入口', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/brain/captures') return response({ items: [{ id, content: '真实收件回执', source: 'dashboard', status: 'captured', area_id: null, owner: '', destination_type: null, destination_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }] });
      if (url === '/api/brain/initiatives?limit=50') return response({ initiatives: [] });
      throw new Error(`未批准的请求：${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(React.createElement(MemoryRouter, { initialEntries: ['/?view=history'] }, React.createElement(GTDInbox)));
    expect(await screen.findByText('真实收件回执')).toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(['/api/brain/captures', '/api/brain/initiatives?limit=50']);
  });

  it('任务页面从tasks和projects读取并显示对应项目，旧路径不能提供所需数据', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/brain/tasks/tasks?limit=500') return response([{ id, title: '真实任务回执', status: 'queued', priority: 'P1', task_type: 'dev', created_at: '2026-01-01T00:00:00Z', completed_at: null, project_id: 'project-1', goal_id: null, claimed_by: null, executor_kind: null, queue_lane: 'ready' }]);
      if (url === '/api/brain/tasks/projects?limit=2000') return response([{ id: 'project-1', title: '真实项目' }]);
      throw new Error(`未批准的请求：${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    render(React.createElement(GTDTasks));
    await waitFor(() => expect(screen.getByText('真实任务回执')).toBeInTheDocument());
    expect(screen.getByText('真实项目')).toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(['/api/brain/tasks/projects?limit=2000', '/api/brain/tasks/tasks?limit=500']);
  });
});
