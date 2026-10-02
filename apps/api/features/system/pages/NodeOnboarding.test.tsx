import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MachinesPage from './MachinesPage';

const base = '/api/brain/machines/onboarding';
const fingerprint = `SHA256:${'a'.repeat(43)}`;
const queued = {
  id: 'request-1', task_id: 'task-1', machine_name: 'node-1', status: 'queued', stage: 'connection' as string | null, error: null as string | null,
  notice: undefined as string | undefined,
  automatic: undefined as boolean | undefined,
  steps: [{ key: 'connection', label: '连接检查', status: 'pending' }],
};
let history: typeof queued[];
let current: typeof queued;
let submissions: { body: Record<string, unknown>; key: string | null }[];
let detailError: boolean, submitError: boolean, retryError: boolean, holdSubmit: boolean;
let releaseSubmit: (() => void) | undefined;
let holdHistory: boolean, machinesError: boolean;
let releaseHistory: (() => void) | undefined;
const machine = (name: string, location: string, extra: Record<string, unknown> = {}) => ({
  id: name, name, description: '', status: 'active', tailscale_online: false, tailscale_last_seen: null,
  metadata: { physical_location: location, services: [], deprecated: [], ...extra }, conflicts: [], updated_at: new Date().toISOString(),
});
let machines: ReturnType<typeof machine>[];
let holdMachines: boolean;
let releaseMachines: (() => void) | undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  machines = []; holdMachines = false; history = []; current = { ...queued }; submissions = []; holdHistory = false; machinesError = false;
  detailError = false; submitError = false; retryError = false; holdSubmit = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/brain/machines') {
      if (holdMachines) await new Promise<void>(resolve => { releaseMachines = resolve; });
      return machinesError ? json({}, 503) : json(machines);
    }
    if (url === base && options?.method === 'POST') {
      submissions.push({ body: JSON.parse(String(options.body)), key: new Headers(options.headers).get('Idempotency-Key') });
      if (holdSubmit) await new Promise<void>(resolve => { releaseSubmit = resolve; });
      return submitError ? json({ error: 'Internal failure' }, 503) : json(current, 202);
    }
    if (url === base) {
      if (holdHistory) await new Promise<void>(resolve => { releaseHistory = resolve; });
      return json({ items: history });
    }
    if (url === `${base}/request-1/retry` || url === `${base}/request-failed/retry`) return retryError ? json({ error: 'Internal failure' }, 409) : json(queued);
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
  it('既有机器从卡片接入，锁定原名称并默认observer，提交不携带UUID或授权', async () => {
    machines = [machine('vps-hk', 'HK', { public_ip: '192.0.2.42', role: '公网入口 & AI 执行节点' })];
    mount(); fireEvent.click(await screen.findByRole('button', { name: '接入管理：vps-hk' }));
    expect(screen.getByLabelText('机器名称', { exact: true })).toHaveValue('vps-hk');
    expect(screen.getByLabelText('机器名称', { exact: true })).toHaveAttribute('readonly');
    expect(screen.getByLabelText('连接地址', { exact: true })).toHaveValue('192.0.2.42');
    expect(screen.getByLabelText('用途', { exact: true })).toHaveValue('observer');
    for (const [label,value] of [['SSH 用户','root'],['1Password 引用','op://CS/node/private key'],['主机指纹',fingerprint]])
      fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}});
    fireEvent.change(screen.getByLabelText('用途',{exact:true}),{target:{value:'worker'}});
    expect(screen.getByText(/独占脚本槽/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'开始接入'}));
    await waitFor(()=>expect(submissions).toHaveLength(1));
    expect(submissions[0].body).toEqual({name:'vps-hk',address:'192.0.2.42',ssh_user:'root',ssh_port:22,
      credential_ref:'op://CS/node/private key',host_key_fingerprint:fingerprint,role:'worker',region:'HK'});
  });
  it('已纳管机器不提供再次采用动作',async()=>{
    machines=[machine('managed-node','HK',{onboarding:{state:'managed'}})];mount();
    await screen.findByRole('button',{name:/managed-node/});
    expect(screen.queryByRole('button',{name:'接入管理：managed-node'})).not.toBeInTheDocument();
  });
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
  it('执行接入完成后持续核验，授权续验时撤下完成提示，重新就绪才刷新设备', async () => {
    current={...queued,status:'completed',automatic:true,notice:'执行已接入'};history=[current];vi.useFakeTimers();await act(async()=>{mount();});
    expect(screen.getByText('执行已接入')).toBeInTheDocument();
    current={...queued,status:'in_progress',automatic:true,notice:'正在续验执行授权'};await tick();
    expect(screen.queryByText('接入完成')).not.toBeInTheDocument();expect(screen.getByText('正在续验执行授权')).toBeInTheDocument();
    const count=()=>vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/brain/machines').length,before=count();
    current={...queued,status:'completed',automatic:true};await tick();expect(count()).toBe(before+1);await tick();expect(count()).toBe(before+1);
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

  it('执行中未收到步骤回执时明确提示等待验收', async () => {
    history = [{ ...queued, status: 'in_progress', stage: null }]; mount();
    expect(await screen.findByText('执行中，等待验收回执')).toBeInTheDocument();
    expect(screen.queryByText('已完成')).not.toBeInTheDocument();
  });
  it('成功后展示监控与执行能力的验收边界说明', async () => {
    history = [queued]; vi.useFakeTimers(); await act(async () => { mount(); });
    current = { ...queued, status: 'completed', notice: '节点监控已接入；清理默认为观察模式，执行任务能力需另行验收' };
    await tick();
    expect(screen.getByText(current.notice!)).toBeInTheDocument();
  });

  it('展示所有地区并保持现有地区优先排序', async () => {
    machines = ['other', 'CN', 'HK', 'US', 'Xian', 'Europe'].map(loc => machine(`node-${loc}`, loc));
    mount(); await screen.findByRole('button', { name: /node-US/ });
    for (const node of machines) expect(screen.getByRole('button', { name: new RegExp(node.name) })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map(item => item.textContent?.trim())).toEqual([
      '🇺🇸 美国', '🇭🇰 香港', '西安', '🇨🇳 中国大陆', '其他', 'Europe',
    ]);
  });
  it('刷新期间保留表单，失败重提仍使用原幂等键', async () => {
    mount(); const submit = await openForm(); fillForm(); submitError = true;
    fireEvent.click(submit); await screen.findByRole('alert');
    holdMachines = true; fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(screen.getByLabelText('机器名称', { exact: true })).toHaveValue('node-1');
    await act(async () => releaseMachines?.());
    submitError = false; fireEvent.click(screen.getByRole('button', { name: '开始接入' }));
    await screen.findByRole('link', { name: '查看任务' });
    expect(submissions).toHaveLength(2);
    expect(submissions[1].key).toBe(submissions[0].key);
  });
  it('恢复最近5个完成记录及说明且不重复刷新设备', async () => {
    history = Array.from({ length: 7 }, (_, index) => ({ ...queued, id: `done-${index}`, machine_name: `done-${index}`, status: 'completed', notice: `验收说明${index}` }));
    mount(); fireEvent.click(await screen.findByRole('button', { name: '接入新机器' }));
    expect(await screen.findByText('验收说明0')).toBeInTheDocument();
    expect(screen.getAllByText('接入完成')).toHaveLength(5);
    expect(screen.queryByText('验收说明5')).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/brain/machines')).toHaveLength(1);
  });
  it('其他请求轮询成功不会抹掉重试操作错误', async () => {
    history = [queued, { ...queued, id: 'request-failed', machine_name: 'failed-node', status: 'failed' }];
    vi.useFakeTimers(); await act(async () => { mount(); });
    retryError = true;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试接入' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('重试接入失败');
    await tick(); expect(screen.getByRole('alert')).toHaveTextContent('重试接入失败');
  });
  it.each(['a', 'Node-1', 'node_1', 'node.1'])('拦截不符合后端契约的机器名称 %s', async name => {
    mount(); const submit = await openForm(); fillForm();
    fireEvent.change(screen.getByLabelText('机器名称', { exact: true }), { target: { value: name } });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('2–63 位小写字母');
    expect(submissions).toHaveLength(0);
  });
  it.each(['a'.repeat(33), 'user$'])('拦截不符合后端契约的 SSH 用户 %s', async user => {
    mount(); const submit = await openForm(); fillForm();
    fireEvent.change(screen.getByLabelText('SSH 用户', { exact: true }), { target: { value: user } });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('SSH 用户');
    expect(submissions).toHaveLength(0);
  });
  it('已验收节点根据真实健康采样显示纳管与执行状态', async () => {
    machines = [machine('healthy-node', 'US', { role: 'observer', onboarding: { state: 'managed' }, node_health: {
      observed_at: new Date(Date.now() - 20_000).toISOString(), capabilities: { collector: true, janitor: true, execution: false },
    } })];
    mount(); const card = await screen.findByRole('button', { name: /healthy-node/ });
    expect(within(card).getByLabelText('健康采样有效')).toBeInTheDocument();
    expect(within(card).getByText('监控纳管')).toBeInTheDocument();
    expect(within(card).getByText('监控节点')).toBeInTheDocument();
    expect(within(card).getByText('执行未启用')).toBeInTheDocument();
    expect(within(card).getByText(/健康采样：.*秒前/)).toBeInTheDocument();
    expect(screen.getByText('1 台监控健康')).toBeInTheDocument();
  });
  it('陈旧采样提示健康过期，不能假报在线或归因为离线', async () => {
    machines = [machine('stale-node', 'HK', { onboarding: { state: 'managed' }, node_health: {
      observed_at: new Date(Date.now() - 600_000).toISOString(), capabilities: { collector: true, janitor: true, execution: false },
    } })];
    mount(); const card = await screen.findByRole('button', { name: /stale-node/ });
    expect(within(card).getByLabelText('健康数据已过期')).toBeInTheDocument();
    expect(within(card).getByText(/健康采样：.*分钟前/)).toBeInTheDocument();
    expect(screen.queryByText('1 台监控健康')).not.toBeInTheDocument();
    expect(within(card).queryByText(/离线/)).not.toBeInTheDocument();
  });
  it('机器卡片只相信后台同代执行投影，metadata自报不能启用执行', async () => {
    const first=machine('trusted-node','HK',{onboarding:{state:'managed'},node_health:{observed_at:new Date().toISOString(),capabilities:{execution:false}}});
    machines=[{...first,execution:{enabled:true,expires_at:new Date(Date.now()+60000).toISOString(),verified_until:new Date(Date.now()+60000).toISOString()}},machine('forged-node','HK',{onboarding:{state:'managed'},node_health:{observed_at:new Date().toISOString(),capabilities:{execution:true}}})] as typeof machines;
    mount();expect(within(await screen.findByRole('button',{name:/trusted-node/})).getByText('执行已启用')).toBeInTheDocument();
    expect(within(screen.getByRole('button',{name:/forged-node/})).getByText('执行未启用')).toBeInTheDocument();
  });
  it('页面停留期间健康采样会自然转为过期', async () => {
    vi.useFakeTimers();
    machines = [machine('aging-node', 'US', { onboarding: { state: 'managed' }, node_health: {
      observed_at: new Date(Date.now() - 290_000).toISOString(), capabilities: { collector: true, janitor: true, execution: false },
    } })];
    await act(async () => { mount(); });
    expect(screen.getByLabelText('健康采样有效')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByLabelText('健康数据已过期')).toBeInTheDocument();
  });

});
