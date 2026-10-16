import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InvocationPanel from './InvocationPanel';
import ActivityDetail from './ActivityDetail';
const target = { kind: 'activity' as const, id: 'a1', definition_version_id: 'v1' };
const ready = { target, readiness: 'ready', gaps: [], input_schema: { type: 'object', properties: { topic: { type: 'string', title: '主题' } }, required: ['topic'] } };
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('现有目录调用', () => {
  it('展示后端blocked和缺口，active不能赋予调用资格', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...ready, readiness: 'blocked', gaps: [{ code: 'transport_missing', message: '缺少运行通道' }] })));
    render(<InvocationPanel target={target} />);
    expect(await screen.findByText('缺少运行通道')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动调用' })).toBeDisabled();
  });
  it('业务输入同键提交，双击只有一次创建；超时按键查回产物', async () => {
    const requests: Array<{url: string; body?: Record<string, unknown>}> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({url, body: init?.body ? JSON.parse(String(init.body)) : undefined});
      if (url.endsWith('/resolve')) return response(ready);
      if (url.includes('/by-request/')) return response({ task_id: 't1', status: 'completed', target, outputs: { artifact: '真实产物' }, evidence: { run_id: 'r1' } });
      if (init?.method === 'POST') throw new TypeError('网络超时');
      throw Error('unexpected ' + url);
    }));
    render(<InvocationPanel target={target} />);
    fireEvent.change(await screen.findByLabelText('主题'), { target: { value: '验收' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '启动调用' })).toBeEnabled());
    const button = screen.getByRole('button', { name: '启动调用' });
    fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findByText('已完成')).toBeInTheDocument();
    expect(screen.getByText(/真实产物/)).toBeInTheDocument();
    const creates = requests.filter(r => r.url.endsWith('/invocations'));
    expect(creates).toHaveLength(1);
    expect(creates[0].body?.input).toEqual({topic:'验收'});
    expect(requests.some(r => r.url.endsWith('/by-request/' + creates[0].body?.request_key))).toBe(true);
  });
  it('切换对象取消旧响应，正式与候选不可混淆', async () => {
    let oldResolve: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn((_: string, init: RequestInit) => JSON.parse(String(init.body)).target.id === 'a1'
      ? new Promise<Response>(resolve => { oldResolve = resolve; })
      : Promise.resolve(response({ ...ready, readiness: 'unverified', gaps: [{ code: 'not_released', message: '尚无正式发布版本' }] }))));
    const view = render(<InvocationPanel target={target} />);
    view.rerender(<InvocationPanel target={{...target, id:'a2'}} />);
    expect(await screen.findByText('尚无正式发布版本')).toBeInTheDocument();
    oldResolve(response(ready));
    await waitFor(() => expect(screen.getByRole('button', {name:'启动调用'})).toBeDisabled());
    expect(screen.getByLabelText('调用用途')).toHaveValue('released');
  });
  it('受理后按既有5秒节奏查回，终态停止轮询', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/resolve') ? response(ready)
      : init?.method === 'POST' ? response({ task_id: 't2', status: 'queued', target })
      : response({ task_id: 't2', status: 'completed', target, evidence: { run_id: 'r2' } }));
    vi.stubGlobal('fetch', fetcher);
    render(<InvocationPanel target={target} />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('主题'), {target:{value:'测试'}});
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', {name:'启动调用'})); });
    expect(screen.getByText('排队中')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText('已完成')).toBeInTheDocument();
    const count = fetcher.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(fetcher.mock.calls).toHaveLength(count);
  });
  it('候选验证回传后端固定身份，不冒充正式发布', async () => {
    const fixed = {...target, definition_version_id:'candidate:hash'};
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/resolve')
      ? response({...ready, target:fixed}) : response({task_id:'t3', status:'failed', target:fixed}));
    vi.stubGlobal('fetch', fetcher);
    render(<InvocationPanel target={target} />);
    await screen.findByLabelText('主题');
    fireEvent.change(screen.getByLabelText('调用用途'), {target:{value:'candidate'}});
    fireEvent.change(screen.getByLabelText('编写任务'), {target:{value:'authoring-task'}});
    fireEvent.change(screen.getByLabelText('候选摘要'), {target:{value:'hash'}});
    fireEvent.change(screen.getByLabelText('主题'), {target:{value:'候选'}});
    await waitFor(() => expect(screen.getByRole('button', {name:'启动调用'})).toBeEnabled());
    expect(screen.getByText('指定版本：candidate:hash')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'启动调用'}));
    expect(await screen.findByText('失败')).toBeInTheDocument();
    const candidateResolve = fetcher.mock.calls.filter(([url]) => url.endsWith('/resolve')).map(([,init]) => JSON.parse(String(init?.body))).find(body => body.mode === 'candidate');
    expect(candidateResolve.target).toEqual({kind:'activity',id:'a1'});
    const create = fetcher.mock.calls.find(([url]) => url.endsWith('/invocations'))!;
    expect(JSON.parse(String(create[1]?.body))).toMatchObject({mode:'candidate', authoring_task_id:'authoring-task', compose_sha256:'hash', target:fixed});
    expect(screen.getByText('验证通过后仍需正式发布门禁。')).toBeInTheDocument();
  });

  it('鉴权失败如实显示无法核对，不能持续冒充加载状态', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({error:{message:'缺少可信授权'}},401)));
    render(<InvocationPanel target={target} />);
    expect(await screen.findByText('缺少可信授权')).toBeInTheDocument();
    expect(screen.getByText('无法核对调用条件')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'启动调用'})).toBeDisabled();
  });

  it('执行前重验拒绝时展示后端更新的资源缺口', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/resolve') ? response(ready)
      : response({error:'INVOCATION_BLOCKED',message:'调用前置条件尚不满足',resolution:{...ready,readiness:'blocked',gaps:[{code:'resource_offline',message:'执行设备已离线'}]}},409)));
    render(<InvocationPanel target={target} />);
    fireEvent.change(await screen.findByLabelText('主题'),{target:{value:'测试'}});
    await waitFor(() => expect(screen.getByRole('button',{name:'启动调用'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'启动调用'}));
    expect(await screen.findByText('执行设备已离线')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'启动调用'})).toBeDisabled();
  });

  it('后端只给缺口代码时展示业务原因，代码收进技术详情', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({...ready,readiness:'blocked',gaps:[{code:'transport_missing'}]})));
    render(<InvocationPanel target={target} />);
    expect(await screen.findByText('缺少可用的执行通道')).toBeInTheDocument();
    expect(screen.getByText('transport_missing')).not.toBeVisible();
    expect(screen.getByRole('button',{name:'启动调用'})).toBeDisabled();
  });

  it.each(['first', 'second'])('同一活动的%s使用位置只在候选请求携带明确slot，正式版本不混入slot', async slot => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)); requests.push(body);
      return response({ ...ready, target: body.target, readiness: 'blocked', gaps: [{code:'input_schema_invalid'}] });
    }));
    const usages = ['first', 'second'].map((key, index) => ({workflow_id:'owned-workflow', reference_id:`ref-${key}`, slot_key:key, sequence_no:index+1, activity_definition_version_id:'v1'}));
    const activity = {id:'actual-activity', name:'共享活动', current_definition_version_id:'v1', consumers:usages};
    const registry = {generated_at:'fixture',counts:{},areas:[],journeys:[],workflows:[],activities:[activity],steps:[],enablers:[],gaps:[],source_repos:[]};
    render(<ActivityDetail selection={{activity,usage:usages.find(u=>u.slot_key===slot)!}} registry={registry} />);
    await screen.findByText('调用受阻');
    expect(requests[0].target).toEqual({kind:'activity',id:'actual-activity',definition_version_id:'v1'});
    fireEvent.change(screen.getByLabelText('调用用途'), {target:{value:'candidate'}});
    fireEvent.change(screen.getByLabelText('编写任务'), {target:{value:'owner-task'}});
    fireEvent.change(screen.getByLabelText('候选摘要'), {target:{value:'d'.repeat(64)}});
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({mode:'candidate',authoring_task_id:'owner-task',compose_sha256:'d'.repeat(64),target:{kind:'activity',id:'actual-activity',slot_key:slot}})));
  });

});

it('原生维护只显示系统入口，不解析Skill资格或开放浏览器启动', () => {
  render(<InvocationPanel target={{kind:'workflow',id:'native'}} schedulerOnly />);
  expect(screen.getByRole('button', {name:'由系统调度或内部管理员触发'})).toBeDisabled();
  expect(screen.getByText(/每30秒执行一个有界轮次/)).toBeTruthy();
});
