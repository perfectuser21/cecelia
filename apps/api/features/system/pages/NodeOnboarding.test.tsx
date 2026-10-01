import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MachinesPage from './MachinesPage';

const base = '/api/brain/machines/onboarding';
const fingerprint = `SHA256:${'a'.repeat(43)}`;
const queued = {
  id: 'request-1', task_id: 'task-1', machine_name: 'node-1', status: 'queued', stage: 'connection', error: null as string | null,
  steps: [{ key: 'connection', label: '连接检查', status: 'pending' }],
};
let history: typeof queued[];
let current: typeof queued;
let submissions: { body: Record<string, unknown>; key: string | null }[];
let detailError: boolean, submitError: boolean, retryError: boolean, holdSubmit: boolean;
let releaseSubmit: (() => void) | undefined;
let holdHistory: boolean, machinesError: boolean;
let releaseHistory: (() => void) | undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  history = []; current = { ...queued }; submissions = []; holdHistory = false; machinesError = false;
  detailError = false; submitError = false; retryError = false; holdSubmit = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/brain/machines') return machinesError ? json({}, 503) : json([]);
    if (url === base && options?.method === 'POST') {
      submissions.push({ body: JSON.parse(String(options.body)), key: new Headers(options.headers).get('Idempotency-Key') });
      if (holdSubmit) await new Promise<void>(resolve => { releaseSubmit = resolve; });
      return submitError ? json({ error: 'Internal failure' }, 503) : json(current, 202);
    }
    if (url === base) {
      if (holdHistory) await new Promise<void>(resolve => { releaseHistory = resolve; });
      return json({ items: history });
    }
    if (url === `${base}/request-1/retry`) return retryError ? json({ error: 'Internal failure' }, 409) : json(queued);
    if (url === `${base}/request-1`) return detailError ? json({ error: 'Internal failure' }, 502) : json(current);
    throw new Error(`Unexpected request: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><MachinesPage /></MemoryRouter>);
async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: '接入新机器' }));
  return screen.getByRole('button', { name: '开始接入' });
}
function fillForm() {
  for (const [label, value] of [
    ['机器名称', 'node-1'], ['连接地址', '100.100.1.2'], ['SSH 用户', 'admin'],
    ['1Password 引用', 'op://CS/node-1/private key'], ['主机指纹', fingerprint],
  ]) fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
}
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(4000); }); }

describe('设备页接入新机器', () => {
  it('校验必填内容、凭据引用与主机指纹，不发送明文密钥', async () => {
    mount(); const submit = await openForm();
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写');
    expect(submissions).toHaveLength(0);
    fillForm();
    fireEvent.change(screen.getByLabelText('1Password 引用', { exact: true }), { target: { value: 'private-key-plaintext' } });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('1Password');
    expect(submissions).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('1Password 引用', { exact: true }), { target: { value: 'op://CS/node-1/private key' } });
    fireEvent.change(screen.getByLabelText('主机指纹', { exact: true }), { target: { value: 'invalid' } });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('SHA256');
    expect(submissions).toHaveLength(0);
    expect(screen.getByText(/云控制台/)).toBeInTheDocument();
  });
  it('默认监控节点，提交只包含引用且禁连击', async () => {
    mount(); const submit = await openForm(); fillForm(); holdSubmit = true;
    fireEvent.click(submit); fireEvent.click(submit);
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submit).toBeDisabled();
    expect(submissions[0].body).toEqual({ name: 'node-1', address: '100.100.1.2', ssh_user: 'admin', ssh_port: 22,
      credential_ref: 'op://CS/node-1/private key', host_key_fingerprint: fingerprint, role: 'observer', region: 'other' });
    expect(submissions[0].key).toMatch(/^[\da-f-]{36}$/i);
    await act(async () => releaseSubmit?.());
    expect(await screen.findByRole('link', { name: '查看任务' })).toHaveAttribute('href', '/workbench/tasks');
  });
  it('提交失败显示中文错误，相同请求再次提交复用幂等键', async () => {
    mount(); const submit = await openForm(); fillForm(); submitError = true;
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('接入请求提交失败');
    expect(screen.getByRole('alert')).toHaveTextContent('503');
    submitError = false; fireEvent.click(submit);
    await screen.findByRole('link', { name: '查看任务' });
    expect(submissions).toHaveLength(2);
    expect(submissions[0].key).toBe(submissions[1].key);
  });
  it('修改失败请求的内容后使用新的幂等键', async () => {
    mount(); const submit = await openForm(); fillForm(); submitError = true;
    fireEvent.click(submit); await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('机器名称', { exact: true }), { target: { value: 'node-2' } });
    submitError = false; fireEvent.click(submit);
    await screen.findByRole('link', { name: '查看任务' });
    expect(submissions[0].key).not.toBe(submissions[1].key);
  });
  it('恢复进行中请求，完成后只刷新一次设备列表', async () => {
    history = [queued]; vi.useFakeTimers(); await act(async () => { mount(); });
    expect(screen.getByText('连接检查')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试接入' })).not.toBeInTheDocument();
    current = { ...queued, status: 'completed', steps: [{ key: 'connection', label: '连接检查', status: 'completed' }] };
    await tick();
    expect(screen.getByText('接入完成')).toBeInTheDocument();
    const count = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/brain/machines').length;
    expect(count()).toBe(2);
    await tick(); expect(count()).toBe(2);
  });
  it('轮询失败保留进度、显示中文错误且不误报成功', async () => {
    history = [queued]; vi.useFakeTimers(); await act(async () => { mount(); });
    expect(screen.getByText('连接检查')).toBeInTheDocument(); detailError = true;
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('进度读取失败');
    expect(screen.queryByText('接入完成')).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/brain/machines')).toHaveLength(1);
    detailError = false; current = { ...queued, status: 'completed' }; await tick();
    expect(screen.getByText('接入完成')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('失败请求提供重试并展示重试错误', async () => {
    history = [{ ...queued, status: 'failed', error: '连接验证失败' }]; mount();
    const retry = await screen.findByRole('button', { name: '重试接入' });
    expect(screen.getByText('连接验证失败')).toBeInTheDocument();
    retryError = true; fireEvent.click(retry);
    expect(await screen.findByRole('alert')).toHaveTextContent('重试接入失败');
    retryError = false; fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试接入' })).not.toBeInTheDocument());
    expect(screen.queryByText('接入完成')).not.toBeInTheDocument();
  });
  it('关闭进度面板后停止轮询，重新打开能恢复', async () => {
    history = [queued]; vi.useFakeTimers(); await act(async () => { mount(); });
    expect(screen.getByText('连接检查')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭接入面板' }));
    const calls = vi.mocked(fetch).mock.calls.length; await tick();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
    fireEvent.click(screen.getByRole('button', { name: '接入新机器' }));
    await act(async () => {});
    expect(screen.getByText('连接检查')).toBeInTheDocument();
  });
  it('卸载页面后停止轮询', async () => {
    history = [queued]; vi.useFakeTimers(); const view = mount(); await act(async () => {});
    expect(screen.getByText('连接检查')).toBeInTheDocument();
    view.unmount(); const calls = vi.mocked(fetch).mock.calls.length;
    await tick(); expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
  });
  it('历史记录晚返回不会覆盖刚提交的请求', async () => {
    holdHistory = true; mount(); const submit = await openForm(); fillForm();
    fireEvent.click(submit); await screen.findByText('连接检查');
    await act(async () => releaseHistory?.());
    expect(screen.getByText('连接检查')).toBeInTheDocument();
  });
  it('设备刷新异常时保留完成结果并显示中文错误', async () => {
    history = [queued]; vi.useFakeTimers(); await act(async () => { mount(); });
    expect(screen.getByText('连接检查')).toBeInTheDocument();
    machinesError = true; current = { ...queued, status: 'completed' }; await tick();
    expect(screen.getByText('接入完成')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('设备列表刷新失败');
  });

});
