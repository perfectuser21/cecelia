import {createHash} from 'node:crypto';
import {DBOS} from '@dbos-inc/dbos-sdk';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (reason, status = 409) => {throw Object.assign(Error(reason), {status});};
const deps = {dispatcher: null, workflowDispatcher: null};

// 注册在模块加载时完成；生产启动在 DBOS.launch 前注入已有公共 dispatcher。
export function configureCommonRunnerDurableDeps({dispatcher, workflowDispatcher} = {}) {
  if (!dispatcher || typeof dispatcher.dispatch !== 'function') fail('common_runner_durable_dispatcher_unconfigured', 503);
  if (workflowDispatcher !== undefined && (!workflowDispatcher || typeof workflowDispatcher.dispatch !== 'function')) fail('common_runner_durable_dispatcher_unconfigured', 503);
  deps.dispatcher = dispatcher;
  deps.workflowDispatcher = workflowDispatcher ?? null;
}

function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 40) fail('common_runner_durable_request_invalid', 400);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)
    || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) fail('common_runner_durable_request_invalid', 400);
  seen.add(value);
  const result = Array.isArray(value) ? value.map(v => canonical(v, seen, depth + 1))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k], seen, depth + 1)]));
  seen.delete(value);
  return result;
}

function normalize(value) {
  if (!object(value) || Object.keys(value).some(k => !['run_id', 'body', 'deadline_ms', 'poll_interval_ms', 'identity_sha256', 'dispatch_scope'].includes(k))
    || !UUID.test(value.run_id ?? '') || !object(value.body)
    || Object.keys(value.body).some(k => !['task_id', 'profile', 'input', 'mode'].includes(k))
    || !UUID.test(value.body.task_id ?? '') || !/^[a-z][a-z0-9-]{0,63}$/.test(value.body.profile ?? '')
    || !object(value.body.input) || !['exploration', 'formal'].includes(value.body.mode)
    || !Number.isSafeInteger(value.deadline_ms) || value.deadline_ms <= 0) fail('common_runner_durable_request_invalid', 400);
  const poll = value.poll_interval_ms ?? 1000;
  if (!Number.isSafeInteger(poll) || poll < 100 || poll > 60000) fail('common_runner_durable_request_invalid', 400);
  const scope = value.dispatch_scope === undefined ? 'public' : value.dispatch_scope;
  if (!['public', 'workflow'].includes(scope)) fail('common_runner_durable_request_invalid', 400);
  const body = canonical(value.body), encoded = JSON.stringify({run_id: value.run_id, dispatch_scope: scope, body});
  if (Buffer.byteLength(encoded) > 1024 * 1024) fail('common_runner_durable_request_invalid', 400);
  const identity = createHash('sha256').update(encoded).digest('hex');
  if (value.identity_sha256 !== undefined && value.identity_sha256 !== identity) fail('common_runner_durable_identity_conflict');
  return {run_id: value.run_id, dispatch_scope: scope, body, identity_sha256: identity, deadline_ms: value.deadline_ms, poll_interval_ms: poll};
}

// 此 step 可能在 ACK 落盘前被重入。公共 dispatcher 已在网络启动前持久化 reservation，
// 相同 start 身份会转 inspect；本模块从不直接启动/重放 Activity。
const observeCommonRunner = DBOS.registerStep(async (action, request) => {
  const observed_at_ms = Date.now();
  if (observed_at_ms >= request.deadline_ms) return {expired: true, observed_at_ms};
  const dispatcher = request.dispatch_scope === 'workflow' ? deps.workflowDispatcher : deps.dispatcher;
  if (!dispatcher) fail('common_runner_durable_dispatcher_unconfigured', 503);
  let observation;
  try {
    observation = await dispatcher.dispatch(action, request.run_id,
      action === 'start' ? request.body : {task_id: request.body.task_id});
  } catch (error) {
    // 确定拒绝不是网络未知；不把敏感或不受信任的错误正文写入运行结果。
    const rejected = [400, 401, 403, 404, 409, 422].includes(error.status);
    observation = {status: rejected ? 'rejected' : 'unknown', next_action: 'inspect',
      reason: /^common_runner_[a-z0-9_]+$/.test(error.message ?? '') ? error.message : 'common_runner_transport_unknown'};
  }
  return {observation, observed_at_ms: Date.now()};
}, {name: 'commonRunnerDurableObserve'});

function terminal(request, observation) {
  const summary = {run_id: request.run_id, task_id: request.body.task_id, observation, business_pass: false};
  if (observation?.status === 'rejected') return {...summary, status: 'needs_review', reason: observation.reason};
  if (observation?.authenticated !== true) return null;
  const receipt = observation.receipt;
  if (!receipt || receipt.run_id !== request.run_id || receipt.task_id !== request.body.task_id) {
    return {...summary, status: 'needs_review', reason: 'common_runner_durable_identity_conflict'};
  }
  if (receipt.execution_unknown === true || ['unknown', 'needs_review', 'unverified'].includes(receipt.status)) {
    return {...summary, status: 'needs_review', reason: 'common_runner_durable_worker_review_required'};
  }
  const expected = {completed: 'success', failed: 'failed', cancelled: 'cancelled'}[receipt.status];
  if (expected && observation.central_run?.recording_status === 'confirmed' && observation.central_run.status === expected) {
    return {...summary, status: receipt.status, business_pass: receipt.status === 'completed'};
  }
  return null;
}

/** 只持有协调和观察；Worker 死亡后的未知执行保持隔离，不推断业务可重放。 */
export const durableCommonRunnerWorkflow = DBOS.registerWorkflow(async value => {
  const request = normalize(value);
  let action = 'start', observation = null;
  while (true) {
    const result = await observeCommonRunner(action, request);
    if (result.observation) observation = result.observation;
    const done = terminal(request, observation);
    if (done) return done;
    if (result.expired || result.observed_at_ms >= request.deadline_ms) {
      return {run_id: request.run_id, task_id: request.body.task_id, status: 'needs_review',
        reason: 'common_runner_durable_deadline_exceeded', business_pass: false, observation};
    }
    // 仅凭已认证的明确未启动回执才重新请求原身份；dispatcher 仍重新校验授权。
    action = observation?.authenticated===true&&observation.receipt?.status==='waiting_resources'
      &&observation.receipt.execution_state==='not_started'?'start':'inspect';
    await DBOS.sleep(Math.min(request.poll_interval_ms, request.deadline_ms - result.observed_at_ms));
  }
}, {name: 'durableCommonRunner'});

/** 仅显式启用且已初始化时允许新启动；失败不会降级成无持久性的裸启动。 */
export async function startDurableCommonRunner(value) {
  const request = normalize(value);
  const dispatcher = request.dispatch_scope === 'workflow' ? deps.workflowDispatcher : deps.dispatcher;
  if (process.env.DBOS_DURABLE_ENABLED !== 'true' || !DBOS.isInitialized() || !dispatcher) fail('common_runner_durable_unavailable', 503);
  const workflow_id = `common-runner:${request.run_id}`;
  const handle = await DBOS.startWorkflow(durableCommonRunnerWorkflow, {workflowID: workflow_id})(request);
  // DBOS 对相同 workflowID 复用原调用；拒绝将不同任务/输入伪装成一次幂等重试。
  // 截止时间仍以原 workflow 入参为准，重复调用不能延长执行窗口。
  const [original] = await handle.getWorkflowInputs();
  if (normalize(original).identity_sha256 !== request.identity_sha256) fail('common_runner_durable_identity_conflict');
  return {workflow_id, handle};
}
