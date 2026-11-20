/** 历史Commander仅保留冻结运行状态读取；正式派发统一交公共adapter。 */
import { execFile } from 'node:child_process';
import { SSH_BASE_ARGS } from './ssh-args.js';
import { sshRun } from './ssh-exec.js';
import { resolvePrimaryWorkerId, sshTargetFor } from '../machine-registry.js';
import { commanderRuntimeRoot } from './commander-runtime-location.js';
import { requireCommander } from './commander-v2-contract.js';
const target = deps => deps.target ?? sshTargetFor(resolvePrimaryWorkerId());
function executionTarget(e, deps) {
  const host = e.execution_location?.ssh_target ?? target(deps);
  requireCommander(typeof host === 'string' && /^[a-zA-Z0-9_.@-]+$/.test(host), '冻结执行宿主非法');
  return host;
}
export async function statusCommander(e, deps = {}) {
  const runtimeRoot = commanderRuntimeRoot(e);
  if (deps.status) return deps.status(e);
  requireCommander(/^wfd-[a-f0-9-]+$/.test(e.run_id), 'run_id非法');
  const raw = await (deps.sshProbe ?? (args => sshRun(execFile, args, { timeout: 15000, encoding: 'utf8' })))([...SSH_BASE_ARGS, executionTarget(e, deps), `${runtimeRoot}/wf-status.sh ${e.run_id}`]);
  return JSON.parse(raw);
}
export async function dispatchCommanderV2(pool, taskId, deps = {}) {
  const {createWorkflowCommonAdapter}=await import('./workflow-common-runner-adapter.js');
  return createWorkflowCommonAdapter(pool,deps.workflowCommon??{}).dispatch(taskId);
}
