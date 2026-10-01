import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GTDInbox from '@features/core/gtd/pages/GTDInbox';
import QuickCapture from '@features/core/gtd/components/QuickCapture';

const taskId = 'a73a7e69-5b08-460f-a290-8f8371403ac8';
const secondId = 'b73a7e69-5b08-460f-a290-8f8371403ac8';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const posted: Record<string, unknown>[] = [];
let post: (body: Record<string, unknown>) => Promise<Response>;
let detail: Record<string, unknown>;
let listFailure = false;
let captureReply: Response;
function renderDesk(path = '/workbench/inbox') {
  return render(<MemoryRouter initialEntries={[path]}><GTDInbox /></MemoryRouter>);
}
const typeTask = (text = '调研测试策略') => fireEvent.change(screen.getByRole('textbox', { name: '交办内容' }), { target: { value: text } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: '提交交办' }));
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  posted.length = 0;
  listFailure = false;
  detail = { id: taskId, title: '内部标题hash', status: 'queued', payload: { intake: { title: '调研测试策略' } } };
  captureReply = json({ id: secondId, status: 'inbox', dedupe_key: 'capture-key', created_at: '2026-10-01' }, 201);
  post = async body => json({ outcome: 'created', source_id: body.source_id, task_id: taskId, task: { id: taskId, title: '调研测试策略', status: 'queued' }, deduplicated: false }, 201);
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === '/api/brain/task-intake' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posted.push(body);
      return post(body);
    }
    if (url.startsWith('/api/brain/task-intake?')) return listFailure ? json({}, 503) : json({ tasks: [] });
    if (url.startsWith('/api/brain/tasks/tasks/')) return json(detail);
    if (url === '/api/brain/captures' && init?.method === 'POST') return captureReply;
    if (url === '/api/capture-atoms') return json([]);
    return json({ items: [], total: 0, counts_by_stage: {} });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('真实 Workbench 交办入口', () => {
  it('默认一个交办输入面，成功只显示真实任务编号并读取详情', async () => {
    renderDesk();
    typeTask(); submit();
    await screen.findByText(`任务编号：${taskId}`);
    expect(posted[0]).toEqual({ text: '调研测试策略', source_id: expect.any(String) });
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '交办内容' })).toHaveAttribute('maxLength', '6000');
    expect(screen.getByRole('region', { name: '任务回执' }).compareDocumentPosition(screen.getByRole('heading', { name: '最近交办' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await screen.findByRole('heading', { name: '调研测试策略' });
    expect(fetch).toHaveBeenCalledWith(`/api/brain/tasks/tasks/${taskId}`, expect.anything());
  });
  it('澄清沿用source_id与原文，补充答案后才出现任务编号', async () => {
    post = async body => body.answers ? json({ outcome: 'created', source_id: body.source_id, task_id: taskId, task: { id: taskId, title: '调研测试策略', status: 'queued' } }) : json({ outcome: 'clarification_required', source_id: body.source_id, task_id: null, questions: [{ id: 'scope', prompt: '需要调研哪个范围？', options: ['前端', '后端'] }] });
    renderDesk(); typeTask(); submit();
    await screen.findByText('需要调研哪个范围？');
    expect(screen.queryByText(`任务编号：${taskId}`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '前端' })); submit();
    await screen.findByText(`任务编号：${taskId}`);
    expect(posted[1]).toEqual({ ...posted[0], answers: { scope: '前端' } });
  });
  it('响应丢失刷新后沿用原请求，改正文不会悄悄另起交办', async () => {
    post = async () => { throw new Error('网络中断'); };
    const mounted = renderDesk(); typeTask(); submit();
    await screen.findByRole('alert');
    const first = posted[0];
    typeTask('改过的调研'); submit();
    await screen.findByText(/原交办内容已保存/);
    expect(posted).toHaveLength(1);
    mounted.unmount(); renderDesk();
    expect(screen.getByRole('textbox', { name: '交办内容' })).toHaveValue('调研测试策略');
    submit(); await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual(first);
  });
  it('同步锁阻止双击重复提交', async () => {
    let resolve!: (r: Response) => void;
    post = () => new Promise(r => { resolve = r; });
    renderDesk(); typeTask();
    const button = screen.getByRole('button', { name: '提交交办' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(posted).toHaveLength(1);
    await act(async () => resolve(json({ error: 'model_unavailable', task_id: null }, 503)));
    expect(screen.getByRole('textbox', { name: '交办内容' })).toHaveValue('调研测试策略');
  });
  it.each([
    [{ outcome: 'created', task_id: null }, 200],
    [{ outcome: 'created', task_id: taskId, task: { id: secondId } }, 200],
    [{ error: 'unsupported_execution', task_id: null }, 422],
    [{ error: 'source_id_conflict', task_id: null }, 409],
    [{ error: 'invalid_model_contract', task_id: null }, 502],
  ])('无效或错误回执不报成功且保留输入 %j', async (body, status) => {
    post = async () => json(body, status);
    renderDesk(); typeTask(); submit(); await screen.findByRole('alert');
    expect(screen.queryByText(`任务编号：${taskId}`)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '交办内容' })).toHaveValue('调研测试策略');
  });
  it('存储受限时阻止无法恢复的提交', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('存储受限'); });
    renderDesk(); typeTask(); submit();
    await screen.findByText(/无法保存重试凭据/);
    expect(posted).toHaveLength(0);
  });
  it('最近交办读取失败显示失败而非空列表', async () => {
    listFailure = true; renderDesk();
    await screen.findByText(/最近交办读取失败/);
    expect(screen.queryByText('还没有交办记录')).not.toBeInTheDocument();
  });
  it('切换模式保留两份草稿，记录编号不冒充任务编号', async () => {
    renderDesk(); typeTask('交办草稿');
    fireEvent.click(screen.getByRole('button', { name: '记下来' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '记录草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '交给 AI 办' }));
    expect(screen.getByRole('textbox')).toHaveValue('交办草稿');
    fireEvent.click(screen.getByRole('button', { name: '记下来' }));
    expect(screen.getByRole('textbox')).toHaveValue('记录草稿');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await screen.findByText('已保存记录');
    expect(screen.getByText(`记录编号：${secondId}`)).toBeInTheDocument();
    expect(screen.queryByText(`任务编号：${secondId}`)).not.toBeInTheDocument();
  });
  it('已取消和完成状态继续轮询，能收到迟到证据', async () => {
    const polls: (() => void)[] = [];
    vi.spyOn(window, 'setInterval').mockImplementation(callback => { polls.push(callback as () => void); return polls.length; });
    detail = { ...detail, status: 'canceled' };
    renderDesk(); typeTask(); submit(); await screen.findByText('已取消');
    detail = { ...detail, status: 'completed_no_pr' };
    await act(async () => { polls.forEach(poll => poll()); });
    await screen.findByText('状态已完成，尚无结果证据');
    detail = { ...detail, result: { receipt: { text: '迟到的真实结果' } } };
    await act(async () => { polls.forEach(poll => poll()); });
    await screen.findByText('迟到的真实结果');
    expect(screen.queryByText('状态已完成，尚无结果证据')).not.toBeInTheDocument();
  });
  it('新选择不被旧详情慢响应覆盖', async () => {
    let resolveOld!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(async input => {
      const url = String(input);
      if (url.startsWith('/api/brain/task-intake?')) return json({ tasks: [{ id: taskId, title: '第一件' }, { id: secondId, title: '第二件' }] });
      if (url.endsWith(taskId)) return new Promise(resolve => { resolveOld = resolve; });
      if (url.endsWith(secondId)) return json({ id: secondId, title: '第二件的详情', status: 'blocked', blocked_reason: '缺少验收条件' });
      return json({ items: [] });
    });
    renderDesk(); await screen.findByRole('button', { name: /第二件/ });
    fireEvent.click(screen.getByRole('button', { name: /第二件/ }));
    await screen.findByRole('heading', { name: '第二件的详情' });
    await act(async () => resolveOld(json({ id: taskId, title: '旧响应覆盖', status: 'completed' })));
    expect(screen.queryByText('旧响应覆盖')).not.toBeInTheDocument();
    expect(screen.getByText('缺少验收条件')).toBeInTheDocument();
  });
  it('成功刷新只读真身，明确新交办才换source_id', async () => {
    const first = renderDesk(); typeTask(); submit(); await screen.findByText(`任务编号：${taskId}`);
    const source = posted[0].source_id;
    first.unmount(); detail = { ...detail, status: 'in_progress' }; renderDesk();
    await screen.findByText('执行中'); expect(posted).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '新交办' })); typeTask('另一件调研'); submit();
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].source_id).not.toBe(source);
  });
  it('完成无证据明确标识，历史记录可进入并返回', async () => {
    detail = { ...detail, status: 'completed_no_pr' };
    renderDesk(); typeTask(); submit();
    await screen.findByText('状态已完成，尚无结果证据');
    fireEvent.click(screen.getByRole('link', { name: '旧记录' }));
    await screen.findByText('Capture 收件箱');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '返回交办台' }));
    expect(screen.getByRole('textbox', { name: '交办内容' })).toBeInTheDocument();
  });
});

describe('记录真实回执', () => {
  it('裸capture回执传给旧兼容回调并限制2000字', async () => {
    const callback = vi.fn(); render(<QuickCapture onSuccess={callback} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('maxLength', '2000');
    fireEvent.change(input, { target: { value: '一个想法' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id: secondId })));
    expect(input).toHaveValue('');
  });
  it('记录网络失败给中文说明并保留输入', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<QuickCapture />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '断线的草稿' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('记录保存失败');
    expect(screen.getByRole('textbox')).toHaveValue('断线的草稿');
  });
  it('200没有真实captureid也保留文字且不通知成功', async () => {
    captureReply = json({ status: 'ok' });
    const callback = vi.fn(); render(<QuickCapture onSuccess={callback} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '不要丢掉' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('alert');
    expect(input).toHaveValue('不要丢掉'); expect(callback).not.toHaveBeenCalled();
  });
});
