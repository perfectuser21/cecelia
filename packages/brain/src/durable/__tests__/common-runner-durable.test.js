import {beforeEach, afterEach, test, expect, vi} from 'vitest';

const mock = vi.hoisted(() => ({initialized: true, sleep: vi.fn(), start: vi.fn()}));
vi.mock('@dbos-inc/dbos-sdk', () => ({DBOS: {
  registerStep: fn => fn, registerWorkflow: fn => fn,
  isInitialized: () => mock.initialized, sleep: (...args) => mock.sleep(...args),
  startWorkflow: (...args) => mock.start(...args),
}}));
import {configureCommonRunnerDurableDeps, durableCommonRunnerWorkflow, startDurableCommonRunner} from '../common-runner-durable.js';

const runId = 'b116399d-0ac4-4ef5-b7e8-e9a8b6cdcd6d';
const taskId = '123bd95e-5c5d-4ef4-9c67-bcb95362e8ca';
const request = () => ({run_id: runId, body: {task_id: taskId, profile: 'fixture', input: {keyword: '真实负载'}, mode: 'exploration'}, deadline_ms: 20000, poll_interval_ms: 100});
const receipt = (status, central = 'pending', extra = {}) => ({authenticated: true,
  receipt: {run_id: runId, task_id: taskId, status, ...extra},
  central_run: {status: status === 'completed' ? 'success' : status, recording_status: central}});
let dispatch, now;
beforeEach(() => {
  now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  mock.initialized = true; process.env.DBOS_DURABLE_ENABLED = 'true';
  mock.start.mockReset(); mock.sleep.mockReset().mockImplementation(async ms => {now += ms;});
  dispatch = vi.fn(); configureCommonRunnerDurableDeps({dispatcher: {dispatch}});
});
afterEach(() => {vi.restoreAllMocks(); delete process.env.DBOS_DURABLE_ENABLED;});

test('真实公共dispatcher先start再inspect，只在中央确认后完成', async () => {
  dispatch.mockResolvedValueOnce(receipt('running')).mockResolvedValueOnce(receipt('completed')).mockResolvedValueOnce(receipt('completed', 'confirmed'));
  const result = await durableCommonRunnerWorkflow(request());
  expect(result.status).toBe('completed');
  expect(dispatch.mock.calls.map(([action]) => action)).toEqual(['start', 'inspect', 'inspect']);
  expect(dispatch.mock.calls.every(([, id, body]) => id === runId && body.task_id === taskId)).toBe(true);
  expect(dispatch.mock.calls[1][2]).toEqual({task_id: taskId});
});

test('start网络结果未知只读回同一run，不发第二次start', async () => {
  dispatch.mockResolvedValueOnce({status: 'unknown', next_action: 'inspect'}).mockRejectedValueOnce(Error('network secret')).mockResolvedValueOnce(receipt('completed', 'confirmed'));
  const result = await durableCommonRunnerWorkflow(request());
  expect(result.status).toBe('completed');
  expect(dispatch.mock.calls.map(([action]) => action)).toEqual(['start', 'inspect', 'inspect']);
  expect(JSON.stringify(result)).not.toContain('network secret');
});

test.each(['unknown', 'needs_review'])('Worker已认证%s立即保留审查，不重放业务', async status => {
  dispatch.mockResolvedValue(receipt(status, 'pending', {reason: 'worker_restarted_execution_unknown', execution_unknown: true}));
  const result = await durableCommonRunnerWorkflow(request());
  expect(result.status).toBe('needs_review'); expect(result.business_pass).toBe(false);
  expect(result.observation.receipt.execution_unknown).toBe(true);
  expect(dispatch).toHaveBeenCalledTimes(1); expect(mock.sleep).not.toHaveBeenCalled();
});

test('超出原绝对deadline不启动、续跑不刷新预算', async () => {
  const expired = {...request(), deadline_ms: now - 1};
  expect((await durableCommonRunnerWorkflow(expired)).reason).toBe('common_runner_durable_deadline_exceeded');
  expect(dispatch).not.toHaveBeenCalled();
  dispatch.mockResolvedValue({status: 'unknown'});
  const result = await durableCommonRunnerWorkflow({...request(), deadline_ms: now + 150});
  expect(result.status).toBe('needs_review'); expect(now).toBe(1150);
  expect(dispatch.mock.calls.map(([action]) => action)).toEqual(['start', 'inspect']);
});

test('失败中央确认才能形成失败终态，completed未知执行不能当成功', async () => {
  dispatch.mockResolvedValueOnce(receipt('failed')).mockResolvedValueOnce(receipt('failed', 'confirmed'));
  expect((await durableCommonRunnerWorkflow(request())).status).toBe('failed');
  dispatch.mockResolvedValue(receipt('completed', 'confirmed', {execution_unknown: true}));
  expect((await durableCommonRunnerWorkflow(request())).status).toBe('needs_review');
});

test('DBOS未启用或未初始化时拒绝新start，不降级直接dispatch', async () => {
  delete process.env.DBOS_DURABLE_ENABLED;
  await expect(startDurableCommonRunner(request())).rejects.toThrow('common_runner_durable_unavailable');
  process.env.DBOS_DURABLE_ENABLED = 'true'; mock.initialized = false;
  await expect(startDurableCommonRunner(request())).rejects.toThrow('common_runner_durable_unavailable');
  expect(dispatch).not.toHaveBeenCalled(); expect(mock.start).not.toHaveBeenCalled();
});

test('workflowID绑定原run；重复请求读原输入，拒绝同run输入身份漂移', async () => {
  let original; const handle = {getWorkflowInputs: async () => [original]};
  mock.start.mockImplementation((_workflow, opts) => async value => {expect(opts.workflowID).toBe(`common-runner:${runId}`); original ??= value; return handle;});
  const first = await startDurableCommonRunner(request());
  expect(first.workflow_id).toBe(`common-runner:${runId}`); expect(first.handle).toBe(handle);
  await startDurableCommonRunner({...request(), deadline_ms: 30000});
  await expect(startDurableCommonRunner({...request(), body: {...request().body, input: {keyword: '别的输入'}}})).rejects.toThrow('common_runner_durable_identity_conflict');
});

test.each([
  x => ({...x, run_id: '../other'}), x => ({...x, deadline_ms: Infinity}),
  x => ({...x, body: {...x.body, endpoint: 'http://other'}}),
  x => ({...x, body: {...x.body, input: {nan: NaN}}}),
])('非法启动输入在DBOS/dispatcher调用前拒绝', async change => {
  await expect(startDurableCommonRunner(change(request()))).rejects.toThrow('common_runner_durable_request_invalid');
  expect(mock.start).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
});
